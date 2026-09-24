"""Login, deal detail/thresholds and the ML serving path (champion -> /predict, /quote anomaly check).
Needs a migrated + seeded DB: DATABASE_URL (costing_app), ADMIN_DATABASE_URL (superuser), JWT_SECRET."""
from __future__ import annotations
import json
import os
import uuid
from datetime import date, timedelta
from decimal import Decimal

import numpy as np
import pandas as pd
import pytest
from sqlalchemy import create_engine, text

ADMIN_URL = os.environ.get("ADMIN_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not (ADMIN_URL and os.environ.get("DATABASE_URL") and os.environ.get("JWT_SECRET")),
    reason="DB URLs / JWT_SECRET not set")

TENANT = "11111111-1111-1111-1111-111111111111"
PRODUCT = "33333333-3333-3333-3333-333333333333"
EMAIL = "ops@example.om"
PASSWORD = os.environ.get("SEED_ADMIN_PASSWORD", "dev-password")
TARGET = "forward_purchase_price_per_kg"


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from costing_api.main import app
    return TestClient(app)


@pytest.fixture(scope="module")
def admin():
    eng = create_engine(ADMIN_URL)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def auth(client):
    r = client.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_login_returns_user_and_working_token(client, auth):
    me = client.get("/api/v1/auth/me", headers=auth)
    assert me.status_code == 200, me.text
    assert me.json()["email"] == EMAIL and me.json()["tenant_id"] == TENANT and me.json()["role"] == "admin"


@pytest.mark.parametrize("email,password", [(EMAIL, "wrong-password"), ("nobody@example.om", PASSWORD)])
def test_login_rejects_bad_credentials_identically(client, email, password):
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 401
    assert r.json()["detail"] == "invalid email or password"


def test_expired_or_forged_token_rejected(client):
    import jwt
    forged = jwt.encode({"sub": "x", "tenant_id": TENANT, "role": "admin"}, "not-the-secret", algorithm="HS256")
    assert client.get("/api/v1/deals", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_unknown_deal_is_404(client, auth):
    assert client.get(f"/api/v1/deals/{uuid.uuid4()}", headers=auth).status_code == 404


@pytest.fixture
def base_case_deal(admin):
    """The CLAUDE.md tripwire deal (18,000 kg CFR 3.20 USD), stored like an imported deal."""
    from costing.fx import FxResolver
    from costing.models import DealInputs
    from costing.money import Money
    from costing.serialize import to_json
    inp = DealInputs(
        product_sku="TUNA-YF-WR", quantity=Decimal("18000"), base_unit="kg", yield_pct=Decimal("0.55"),
        purchase_unit_price_major=Decimal("3.20"), currency="USD", incoterm="CFR",
        insurance_rate=Decimal("0.004"), hs_code="0303.42", duty_rate=Decimal("0.05"),
        vat_rate=Decimal("0.05"), clearing_fixed=Money.from_major("250", "OMR"),
        processing_rate_per_unit=Money.from_major("0.080", "OMR"), storage_days=15,
        storage_rate_per_unit_day=Money.from_major("0.003", "OMR"), days_to_customer_payment=45,
        supplier_terms_days=30, wacc=Decimal("0.08"), overhead_pct=Decimal("0.03"),
        locked_rates={"USD": FxResolver().rate("USD", "OMR")}, base_currency="OMR")
    deal_id = str(uuid.uuid4())
    with admin.begin() as c:
        c.execute(text("""
          INSERT INTO deals (id, tenant_id, deal_ref, product_id, quantity, base_unit, incoterm, origin_country,
                             dest_country, deal_date, currency, base_currency, inputs_snapshot,
                             actual_landed_cost_minor, actual_sell_price_minor, status)
          VALUES (:id, :t, :ref, :p, 18000, 'kg', 'CFR', 'TH', 'OM', DATE '2025-01-15', 'USD', 'OMR',
                  CAST(:snap AS jsonb), 26720146, 33400000, 'confirmed')
        """), {"id": deal_id, "t": TENANT, "ref": f"TEST-{deal_id[:8]}", "p": PRODUCT,
               "snap": json.dumps(to_json(inp))})
        c.execute(text("""
          INSERT INTO deal_cost_lines (tenant_id, deal_id, cost_type, amount_minor, currency, line_order)
          VALUES (:t, :d, 'purchase', 22147200, 'OMR', 0)
        """), {"t": TENANT, "d": deal_id})
    yield deal_id
    with admin.begin() as c:
        c.execute(text("DELETE FROM deals WHERE id = :id"), {"id": deal_id})


def test_deal_detail_and_list(client, auth, base_case_deal):
    d = client.get(f"/api/v1/deals/{base_case_deal}", headers=auth)
    assert d.status_code == 200, d.text
    body = d.json()
    assert body["sku"] == "TUNA-YF-WR" and "inputs_snapshot" not in body
    assert [l["type"] for l in body["lines"]] == ["purchase"]
    listed = client.get("/api/v1/deals", params={"q": body["deal_ref"]}, headers=auth).json()["items"]
    assert [x["id"] for x in listed] == [base_case_deal]


def test_deal_thresholds_match_tripwire(client, auth, base_case_deal):
    r = client.get(f"/api/v1/deals/{base_case_deal}/thresholds", headers=auth)
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["landed_per_sellable"]["amount_minor"] == 2_699
    assert t["sell_above_threshold"]["amount_minor"] == 2_834
    assert t["actual_sell_per_sellable"]["amount_minor"] == round(33_400_000 / 9_900)
    ys = [p["landed_per_sellable_minor"] for p in t["curve"]]
    assert len(ys) == 21 and ys == sorted(ys)          # landed rises with purchase price
    assert t["curve"][10]["purchase_unit_price_major"] == "3.2000"
    assert t["curve"][10]["landed_per_sellable_minor"] == 2_699
    # selling at 3.374/kg with a 20% margin leaves 2.699/kg of landed cost: the deal's own price
    assert abs(Decimal(t["buy_below_threshold"]["amount_major"]) - Decimal("3.20")) <= Decimal("0.01")


def test_predict_without_champion(client, auth, admin):
    with admin.connect() as c:
        if c.execute(text("SELECT count(*) FROM model_registry WHERE tenant_id = :t AND is_champion"),
                     {"t": TENANT}).scalar():
            pytest.skip("tenant already has a champion")
    r = client.get("/api/v1/predict", params={"product_sku": "TUNA-YF-WR"}, headers=auth)
    assert r.status_code == 200, r.text
    assert r.json()["available"] is False and r.json()["reason"] == "no champion model"


def test_predict_unknown_product_is_404(client, auth):
    assert client.get("/api/v1/predict", params={"product_sku": "NOPE"}, headers=auth).status_code == 404


@pytest.fixture
def champion(admin, tmp_path):
    """A real LightGBM champion trained on synthetic rows shaped like build_features output."""
    from ml.datasets import FORWARD_PRICE
    from ml.models import train
    rng = np.random.default_rng(0)
    rows = []
    for i in range(240):
        d = date(2024, 1, 1) + timedelta(days=i)
        spot = 3.0 + 0.3 * np.sin(i / 20) + rng.normal(0, 0.02)
        rows.append({"species": "YF", "form": "WR", "grade": "A", "origin_country": "TH",
                     "spot_price_lag1": spot, "spot_price_lag7": spot, "spot_price_lag30": spot,
                     "fx_lag1": 1.0, "fx_lag7": 1.0, "fx_lag30": 1.0,
                     "month_sin": float(np.sin(2 * np.pi * d.month / 12)),
                     "month_cos": float(np.cos(2 * np.pi * d.month / 12)),
                     "is_ramadan": 0, "forward_price_kg": spot * 1.02})
    model = train(pd.DataFrame(rows), FORWARD_PRICE.feature_spec, FORWARD_PRICE.target_col,
                  name=TARGET, version="vtest")
    path = model.save(tmp_path)
    with admin.begin() as c:
        c.execute(text("""
          INSERT INTO model_registry (tenant_id, target, version, artifact_path, target_currency, target_unit,
                                      library_versions, is_champion, promoted_at)
          VALUES (:t, :tg, 'vtest', :p, 'USD', 'kg', CAST(:lv AS jsonb), true, now())
        """), {"t": TENANT, "tg": TARGET, "p": str(path), "lv": json.dumps(model.library_versions)})
    yield
    with admin.begin() as c:
        c.execute(text("DELETE FROM model_registry WHERE tenant_id = :t AND version = 'vtest'"), {"t": TENANT})


def test_predict_serves_champion(client, auth, champion):
    r = client.get("/api/v1/predict", params={"product_sku": "TUNA-YF-WR"}, headers=auth)
    assert r.status_code == 200, r.text
    f = r.json()
    assert f["available"] is True, f
    assert f["model_version"] == "vtest" and f["target_currency"] == "USD" and f["target_unit"] == "kg"
    assert 2.5 < float(f["p50"]) < 4.0            # seed market is flat 3.20 USD/kg
    assert 1 <= len(f["shap_top5"]) <= 5


def test_quote_anomaly_check_uses_champion_but_never_overrides_price(client, auth, champion):
    req = {"product_sku": "TUNA-YF-WR", "quantity": "18000", "base_unit": "kg", "currency": "USD",
           "incoterm": "CFR", "purchase_unit_price_major": "3.20"}
    q = client.post("/api/v1/quote", json=req, headers=auth)
    assert q.status_code == 200, q.text
    body = q.json()
    assert body["ml_skipped_reason"] is None
    assert body["quote_vs_forecast"]["quote_price"] == "3.20"
    assert body["landed_cost"]["amount_minor"] == 26_720_146     # ML never changes the landed cost
