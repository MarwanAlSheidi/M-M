"""Products, cost elements, margin config, envelope, market ingest, BOM import, recompute job and
the ML serving path. Needs a migrated + seeded DB: DATABASE_URL (costing_app),
ADMIN_DATABASE_URL (superuser), JWT_SECRET. Creates its own products and deletes them."""
from __future__ import annotations
import io
import json
import os
import uuid
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest
from sqlalchemy import create_engine, text

ADMIN_URL = os.environ.get("ADMIN_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not (ADMIN_URL and os.environ.get("DATABASE_URL") and os.environ.get("JWT_SECRET")),
    reason="DB URLs / JWT_SECRET not set")

TENANT = "11111111-1111-1111-1111-111111111111"
USER = "22222222-2222-2222-2222-222222222222"
SEEDED = "33333333-3333-3333-3333-333333333333"
EMAIL = "ops@example.om"
PASSWORD = os.environ.get("SEED_ADMIN_PASSWORD", "dev-password")
POSITIONS = {"attractive", "too_high", "too_low", "not_viable"}


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from costing_api.main import app
    return TestClient(app)


@pytest.fixture(scope="module")
def admin_db():
    eng = create_engine(ADMIN_URL)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def auth(client):
    r = client.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def viewer():
    import jwt
    from costing_api.settings import settings
    tok = jwt.encode({"sub": USER, "tenant_id": TENANT, "role": "user"}, settings.jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture
def product(client, auth, admin_db):
    name = f"test-bread-{uuid.uuid4().hex[:8]}"
    r = client.post("/api/v1/products", headers=auth, json={
        "name": name, "category": "bakery", "base_unit": "loaf", "attributes": {"weight_g": 600}})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    yield pid
    with admin_db.begin() as c:
        c.execute(text("DELETE FROM products WHERE id = :p"), {"p": pid})


def _configure(client, auth, pid, max_pct="0.45"):
    for el in ({"name": "flour", "unit": "kg", "rate": "0.400", "currency": "OMR", "qty_per_unit": "0.5",
                "valid_from": "2024-01-01"},
               {"name": "energy", "unit": "loaf", "rate": "0.050", "currency": "OMR", "valid_from": "2024-01-01"},
               {"name": "packaging", "unit": "loaf", "rate": "0.10", "currency": "USD", "valid_from": "2024-01-01"}):
        r = client.post(f"/api/v1/products/{pid}/cost-elements", headers=auth, json=el)
        assert r.status_code == 201, r.text
    body = {"min_pct": "0.15", "target_pct": "0.30", "valid_from": "2024-01-01"}
    if max_pct:
        body["max_pct"] = max_pct
    r = client.post(f"/api/v1/products/{pid}/margin-config", headers=auth, json=body)
    assert r.status_code == 201, r.text


def test_login_and_me(client, auth):
    me = client.get("/api/v1/auth/me", headers=auth).json()
    assert me["email"] == EMAIL and me["tenant_id"] == TENANT and me["role"] == "admin"
    bad = client.post("/api/v1/auth/login", json={"email": EMAIL, "password": "wrong"})
    assert bad.status_code == 401 and bad.json()["detail"] == "invalid email or password"


def test_seeded_product_envelope_matches_engine_tripwire(client, auth):
    r = client.post("/api/v1/envelope", headers=auth, json={"product_id": SEEDED})
    assert r.status_code == 200, r.text
    e = r.json()
    assert (e["unit_cost_minor"], e["floor_minor"], e["target_minor"], e["ceiling_minor"]) == (1868, 2198, 2669, 3396)
    assert e["currency"] == "OMR" and e["unit"] == "bag" and e["ceiling_source"] == "max_pct"
    assert len(e["lines"]) == 6 and e["explanation"]


def test_product_crud_and_admin_only_writes(client, auth, viewer, product):
    listed = {p["id"]: p for p in client.get("/api/v1/products", headers=viewer).json()["items"]}
    assert product in listed and SEEDED in listed
    name = listed[product]["name"]
    assert client.post("/api/v1/products", headers=auth,
                       json={"name": name, "category": "x", "base_unit": "u"}).status_code == 409
    assert client.post("/api/v1/products", headers=viewer,
                       json={"name": "nope", "category": "x", "base_unit": "u"}).status_code == 403
    assert client.post(f"/api/v1/products/{product}/cost-elements", headers=viewer,
                       json={"name": "x", "unit": "u", "rate": "1", "currency": "OMR"}).status_code == 403
    p = client.patch(f"/api/v1/products/{product}", headers=auth, json={"category": "bakery-fresh"})
    assert p.status_code == 200 and p.json()["category"] == "bakery-fresh" and p.json()["name"] == name
    assert client.get(f"/api/v1/products/{uuid.uuid4()}", headers=auth).status_code == 404


def test_envelope_needs_configuration(client, auth, product):
    r = client.post("/api/v1/envelope", headers=auth, json={"product_id": product})
    assert r.status_code == 422 and "no cost elements" in r.json()["detail"]
    assert client.get(f"/api/v1/envelope/{product}", headers=auth).status_code == 404


def test_envelope_market_position_and_snapshot(client, auth, product):
    _configure(client, auth, product)
    e = client.post("/api/v1/envelope", headers=auth, json={"product_id": product}).json()
    # flour 0.400 x 0.5 = 0.200, energy 0.050, packaging 0.10 USD -> 0.038 OMR (0.03845)
    assert e["unit_cost_minor"] == 288
    assert (e["floor_minor"], e["target_minor"], e["ceiling_minor"]) == (339, 411, 524)
    assert e["floor_minor"] < e["target_minor"] < e["ceiling_minor"] and e["market"] is None

    today = date.today()
    csv = "observed_at,price,currency,unit\n" + "\n".join(
        f"{today - timedelta(days=d)},{p},OMR,loaf" for d, p in ((1, "0.450"), (3, "0.440"), (40, "9.999")))
    r = client.post("/api/v1/market-prices/ingest-csv", headers=auth,
                    data={"product_id": product, "source": "shop-audit"},
                    files={"file": ("prices.csv", io.BytesIO(csv.encode()), "text/csv")})
    assert r.status_code == 200, r.text
    assert r.json() == {"rows": 3, "received": 3}
    e = client.post("/api/v1/envelope", headers=auth, json={"product_id": product}).json()
    # latest per source (0.450); the 40-day-old row is outside the default 30-day staleness anyway
    m = e["market"]
    assert m["market_reference_minor"] == 450 and m["position"] == "attractive" and m["position"] in POSITIONS
    assert (m["gap_to_floor"], m["gap_to_target"], m["gap_to_ceiling"]) == (111, 39, -74)

    latest = client.get(f"/api/v1/envelope/{product}", headers=auth).json()
    assert latest["snapshot_id"] == e["snapshot_id"] and latest["market"]["position"] == "attractive"
    assert latest["floor_minor"] == 339 and latest["computed_by"] == "api"


@pytest.mark.parametrize("price,position", [("0.280", "not_viable"), ("0.300", "too_low"), ("0.600", "too_high")])
def test_positions_via_api(client, auth, product, price, position):
    _configure(client, auth, product)
    client.post("/api/v1/market-prices/ingest", headers=auth, json={
        "product_id": product, "source": "s", "rows": [
            {"price": price, "currency": "OMR", "unit": "loaf", "observed_at": str(date.today())}]})
    e = client.post("/api/v1/envelope", headers=auth, json={"product_id": product}).json()
    assert e["market"]["position"] == position


def test_ceiling_falls_back_to_mirror(client, auth, product):
    _configure(client, auth, product, max_pct=None)
    e = client.post("/api/v1/envelope", headers=auth, json={"product_id": product}).json()
    assert e["ceiling_source"] == "mirror" and e["ceiling_minor"] == 411 + (411 - 339)


def test_versioning_closes_old_rate_and_keeps_bom_qty(client, auth, product):
    _configure(client, auth, product)
    r = client.post(f"/api/v1/products/{product}/cost-elements", headers=auth, json={
        "name": "flour", "unit": "kg", "rate": "0.600", "currency": "OMR", "valid_from": "2025-06-01"})
    assert r.status_code == 201 and r.json()["replaced_id"] and float(r.json()["qty_per_unit"]) == 0.5
    old = client.post("/api/v1/envelope", headers=auth, json={"product_id": product, "as_of": "2025-05-31"}).json()
    new = client.post("/api/v1/envelope", headers=auth, json={"product_id": product, "as_of": "2025-06-01"}).json()
    assert old["unit_cost_minor"] == 288 and new["unit_cost_minor"] == 388      # flour 0.200 -> 0.300
    stale = client.post(f"/api/v1/products/{product}/cost-elements", headers=auth, json={
        "name": "flour", "unit": "kg", "rate": "0.1", "currency": "OMR", "valid_from": "2025-01-01"})
    assert stale.status_code == 409
    bad = client.post(f"/api/v1/products/{product}/margin-config", headers=auth,
                      json={"min_pct": "0.30", "target_pct": "0.15", "valid_from": "2026-01-01"})
    assert bad.status_code == 422
    detail = client.get(f"/api/v1/products/{product}", headers=auth).json()
    flour = [c for c in detail["cost_elements"] if c["name"] == "flour"]
    assert len(flour) == 2 and sum(c["current"] for c in flour) == 1


def test_envelope_recompute_job_stores_snapshots(admin_db, product, client, auth):
    _configure(client, auth, product)
    from costing_api.jobs import envelope_recompute
    from costing_api.jobs.base import tenant_session
    with tenant_session(TENANT) as s:
        res = envelope_recompute.run(s, tenant_id=TENANT)
    assert res["rows"] >= 2                            # the seeded product and this one
    with admin_db.connect() as c:
        n = c.execute(text("SELECT count(*) FROM pricing_snapshots WHERE product_id = :p "
                           "AND computed_by = 'envelope_recompute'"), {"p": product}).scalar()
    assert n == 1


def test_bom_import_creates_cost_elements(client, auth, product, admin_db):
    with admin_db.connect() as c:
        name = c.execute(text("SELECT name FROM products WHERE id = :p"), {"p": product}).scalar()
    csv = ("Product,Component,UOM,Price,Currency,Usage,Effective\n"
           f"{name},flour,kg,0.400,OMR,0.5,2024-01-01\n"
           f"{name},yeast,kg,2.000,OMR,0.01,2024-01-01\n"
           f"no-such-product,flour,kg,1,OMR,1,2024-01-01\n")
    up = client.post("/api/v1/imports", headers=auth, data={"kind": "bom"},
                     files={"file": (f"bom-{uuid.uuid4().hex}.csv", io.BytesIO(csv.encode()), "text/csv")})
    assert up.status_code == 200, up.text
    b = up.json()
    assert b["suggested_mapping"] == {"product": "Product", "element": "Component", "unit": "UOM", "rate": "Price",
                                      "currency": "Currency", "qty_per_unit": "Usage", "valid_from": "Effective"}
    bid = b["batch_id"]
    assert client.post(f"/api/v1/imports/{bid}/map", headers=auth, json={
        "column_map": b["suggested_mapping"], "date_format": "%Y-%m-%d"}).status_code == 200
    st = client.post(f"/api/v1/imports/{bid}/stage", headers=auth).json()
    assert st["counts"] == {"ok": 2, "rejected": 1}
    conf = client.post(f"/api/v1/imports/{bid}/confirm", headers=auth).json()
    assert conf["applied"] == 2 and conf["failed"] == []
    detail = client.get(f"/api/v1/products/{product}", headers=auth).json()
    assert {c["name"]: float(c["qty_per_unit"]) for c in detail["cost_elements"]} == {"flour": 0.5, "yeast": 0.01}


def test_predict_without_champion(client, auth):
    r = client.get("/api/v1/predict", params={"product_id": SEEDED}, headers=auth)
    assert r.status_code == 200 and r.json()["available"] is False


@pytest.fixture
def champion(admin_db, tmp_path, product):
    """A real LightGBM market-price champion on synthetic rows, plus 40 days of prices for features."""
    from ml.datasets import MARKET_PRICE
    from ml.models import train
    rng = np.random.default_rng(0)
    rows = []
    for i in range(240):
        d = date(2024, 1, 1) + timedelta(days=i)
        p = 0.45 + 0.03 * np.sin(i / 20) + rng.normal(0, 0.002)
        rows.append({"category": "bakery", "price_lag1": p, "price_lag7": p, "price_lag30": p,
                     "month_sin": float(np.sin(2 * np.pi * d.month / 12)),
                     "month_cos": float(np.cos(2 * np.pi * d.month / 12)), "is_ramadan": 0, "price_fwd": p * 1.02})
    model = train(pd.DataFrame(rows), MARKET_PRICE.feature_spec, MARKET_PRICE.target_col,
                  name=MARKET_PRICE.name, version="vtest")
    path = model.save(tmp_path)
    with admin_db.begin() as c:
        for d in range(40):
            c.execute(text("INSERT INTO market_prices (tenant_id, product_id, source, price_minor, currency, unit, "
                           "observed_at) VALUES (:t, :p, 'hist', 450, 'OMR', 'loaf', :d)"),
                      {"t": TENANT, "p": product, "d": date.today() - timedelta(days=d)})
        c.execute(text("""
          INSERT INTO model_registry (tenant_id, target, version, artifact_path, target_currency, target_unit,
                                      library_versions, is_champion, promoted_at)
          VALUES (:t, :tg, 'vtest', :p, 'OMR', 'product_unit', CAST(:lv AS jsonb), true, now())
        """), {"t": TENANT, "tg": MARKET_PRICE.name, "p": str(path), "lv": json.dumps(model.library_versions)})
    yield
    with admin_db.begin() as c:
        c.execute(text("DELETE FROM model_registry WHERE tenant_id = :t AND version = 'vtest'"), {"t": TENANT})


def test_predict_serves_champion_and_never_moves_envelope(client, auth, product, champion):
    _configure(client, auth, product)
    f = client.get("/api/v1/predict", params={"product_id": product}, headers=auth).json()
    assert f["available"] is True, f
    assert f["model_version"] == "vtest" and f["target_currency"] == "OMR" and f["target_unit"] == "loaf"
    assert 0.3 < float(f["p50"]) < 0.7 and 1 <= len(f["shap_top5"]) <= 5
    e = client.post("/api/v1/envelope", headers=auth, json={"product_id": product}).json()
    assert (e["floor_minor"], e["target_minor"], e["ceiling_minor"]) == (339, 411, 524)


def test_retrain_trains_market_target_when_history_exists(admin_db, product, client, auth):
    """The gated path smoke never reaches: 400 days of prices -> walk-forward folds -> promote decision."""
    import math
    with admin_db.begin() as c:
        for d in range(400):
            c.execute(text("INSERT INTO market_prices (tenant_id, product_id, source, price_minor, currency, unit, "
                           "observed_at) VALUES (:t, :p, 'hist', :m, 'OMR', 'loaf', :d)"),
                      {"t": TENANT, "p": product, "m": 450 + int(30 * math.sin(d / 15)),
                       "d": date.today() - timedelta(days=d)})
    from costing_api.jobs import retrain
    from costing_api.jobs.base import tenant_session
    try:
        with tenant_session(TENANT) as s:
            res = retrain.run(s, tenant_id=TENANT)
        market = res["reason"].split(";")[0]
        assert market.startswith("forecast_market_price_per_product:"), res
        assert "history" not in market and "no folds" not in market, res     # LightGBM trained on folds
        assert "estimate_elasticity: no transaction data" in res["reason"]
    finally:
        with admin_db.begin() as c:
            c.execute(text("DELETE FROM model_registry WHERE tenant_id = :t AND version LIKE 'v%'"
                           " AND target = 'forecast_market_price_per_product'"), {"t": TENANT})
