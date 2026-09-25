"""POST /api/v1/simulate: same numbers as scripts/last_sell_price.py, recommendation rule, margin inputs,
and no writes. Loads sample_data/canned_tuna_* (skipjack 1.40, four channels) into a throwaway tenant."""
from __future__ import annotations
import json
import os
import subprocess
import sys
import uuid
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

ADMIN_URL = os.environ.get("ADMIN_DATABASE_URL")
ROOT = Path(__file__).resolve().parents[3]
SAMPLE = ROOT / "sample_data"
AS_OF = date(2026, 9, 25)           # the channel rows are dated 2026-09-08..22; pin so they stay fresh
pytestmark = pytest.mark.skipif(
    not (ADMIN_URL and os.environ.get("DATABASE_URL") and os.environ.get("JWT_SECRET")
         and (SAMPLE / "canned_tuna_product.json").exists()),
    reason="DB URLs / JWT_SECRET not set or sample_data/ not in this checkout (api image)")


@pytest.fixture(scope="module")
def admin_db():
    eng = create_engine(ADMIN_URL)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def tuna(admin_db):
    """(tenant_id, product_id) with the current canned tuna sample loaded via the loader's service calls."""
    from costing_api.jobs.base import tenant_session
    from costing_api.schemas import CostElementIn, MarginConfigIn, ProductIn
    from costing_api.services import product_service
    tid = str(uuid.uuid4())
    with admin_db.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name, base_currency) VALUES (:i, :n, 'OMR')"),
                  {"i": tid, "n": f"simulate-{tid[:6]}"})
    spec = json.loads((SAMPLE / "canned_tuna_product.json").read_text())
    tenant = {"tenant_id": tid, "user_id": None, "role": "admin"}
    vf = date(2026, 1, 1)
    with tenant_session(tid) as s:
        p = ProductIn(**{k: spec[k] for k in ("name", "category", "base_unit")}, attributes=spec["attributes"])
        pid = str(product_service.create_product(s, tenant, p.name, p.category, p.base_unit, p.attributes)["id"])
        for raw in spec["cost_elements"]:
            e = CostElementIn(**{**raw, "valid_from": vf})
            product_service.add_cost_element(s, tenant, pid, name=e.name, unit=e.unit, rate=e.rate,
                                             currency=e.currency, valid_from=vf, qty_per_unit=e.qty_per_unit)
        m = MarginConfigIn(**{**spec["margin"], "valid_from": vf})
        product_service.set_margin_config(s, tenant, pid, m.min_pct, m.target_pct, m.max_pct, vf)
        # the real loader path: market_sources upserted once per source with its channel_type, then prices
        sys.path.insert(0, str(ROOT / "scripts"))
        from load_market_prices import load as load_prices, read_rows
        load_prices(s, tenant, pid, read_rows(SAMPLE / "canned_tuna_market.csv"))
    yield tid, pid
    with admin_db.begin() as c:
        for tbl in ("pricing_snapshots", "market_prices", "products", "audit_log"):
            c.execute(text(f"DELETE FROM {tbl} WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from costing_api.main import app
    return TestClient(app)


@pytest.fixture(scope="module")
def auth(tuna):
    import jwt
    from costing_api.settings import settings
    tok = jwt.encode({"sub": str(uuid.uuid4()), "tenant_id": tuna[0], "role": "user"}, settings.jwt_secret,
                     algorithm="HS256")
    return {"Authorization": f"Bearer {tok}"}


def sim(client, auth, pid, **kw):
    r = client.post("/api/v1/simulate", headers=auth, json={"product_id": pid, "as_of": str(AS_OF), **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_defaults_match_last_sell_price_script(client, auth, tuna):
    tid, pid = tuna
    out = subprocess.run([sys.executable, "scripts/last_sell_price.py", "Canned Light Tuna in Sunflower Oil",
                          "--as-of", str(AS_OF), "--tenant", tid], cwd=ROOT, capture_output=True, text=True,
                         env={**os.environ})
    assert out.returncode == 0, out.stderr
    lines = out.stdout.splitlines()
    head = lines.index(next(l for l in lines if l.startswith("channel | min | latest")))
    script = {}
    for line in lines[head + 1:]:
        if not line.strip():
            break
        f = [x.strip() for x in line.split("|")]
        script[f[0]] = {"latest": f[2], "unit_cost": f[4], "floor": f[5], "target": f[6], "ceiling": f[7],
                        "position": f[8], "headroom": f[9], "verdict": f[11]}

    s = sim(client, auth, pid, skipjack_usd="1.40", margin_floor_pct="15", margin_target_pct="30")
    fmt = lambda m: f"{m / 1000:.3f}"    # noqa: E731  OMR
    e = s["envelope"]
    assert set(script) == {c["channel"] for c in s["channels"]} == {"oman-import", "mena-export", "uae-export",
                                                                     "oman-retail"}
    for c in s["channels"]:
        row = script[c["channel"]]
        assert row == {"latest": fmt(c["market_ref_minor"]), "unit_cost": fmt(e["unit_cost_minor"]),
                       "floor": fmt(e["floor_minor"]), "target": fmt(e["target_minor"]),
                       "ceiling": fmt(e["ceiling_minor"]), "position": c["position"],
                       "headroom": f"{c['headroom_pct']:+.1f}", "verdict": c["verdict"]}, c["channel"]
    assert (e["unit_cost_minor"], e["floor_minor"], e["target_minor"], e["ceiling_minor"]) == (1557, 1832, 2224, 2831)
    assert s["last_viable_sell_minor"] == 1832 and s["currency"] == "OMR" and s["unit"] == "kg"


def test_channel_type_on_every_entry(client, auth, tuna):
    s = sim(client, auth, tuna[1])
    assert {c["channel"]: c["channel_type"] for c in s["channels"]} == {
        "oman-import": "import", "mena-export": "export", "uae-export": "export", "oman-retail": "retail"}


def test_default_exclusion_by_type(client, auth, tuna):
    s = sim(client, auth, tuna[1])                                         # no exclude_channels sent
    assert s["recommendation"] == "uae-export"
    assert s["inputs"]["exclusion"] == "default_by_type"
    assert {c["channel"] for c in s["channels"] if c["excluded"]} == {"oman-retail", "oman-import"}


def test_caller_list_wins_without_extra_defaults(client, auth, tuna):
    pid = tuna[1]
    everything = sim(client, auth, pid, exclude_channels=[])               # rule as written, nothing excluded
    assert everything["recommendation"] == "oman-retail" and everything["inputs"]["exclusion"] == "caller"
    # Only uae-export excluded: retail is NOT excluded by default any more (the caller's list wins), and it is
    # the only comfortable channel left (mena-export is marginal at +0.3%), so the rule picks it.
    no_uae = sim(client, auth, pid, exclude_channels=["uae-export"])
    assert [c["channel"] for c in no_uae["channels"] if c["excluded"]] == ["uae-export"]
    assert no_uae["recommendation"] == "oman-retail"
    # Excluding retail as well leaves only mena-export (marginal) and oman-import (not sellable): none.
    assert sim(client, auth, pid, exclude_channels=["uae-export", "oman-retail"])["recommendation"] is None


def test_skipjack_180_with_defaults_recommends_none(client, auth, tuna):
    hot = sim(client, auth, tuna[1], skipjack_usd="1.80")                  # defaults: retail + import excluded
    by = {c["channel"]: c for c in hot["channels"]}
    assert by["uae-export"]["headroom_pct"] == 5.1 and by["uae-export"]["verdict"] == "sellable_marginal"
    assert hot["recommendation"] is None


def test_margin_floor_changes_the_floor(client, auth, tuna):
    pid = tuna[1]
    f10 = sim(client, auth, pid, margin_floor_pct="10")["envelope"]
    f20 = sim(client, auth, pid, margin_floor_pct="20")["envelope"]
    assert f10["unit_cost_minor"] == f20["unit_cost_minor"] == 1557
    assert (f10["floor_minor"], f20["floor_minor"]) == (1730, 1946)        # 1557 / 0.90, 1557 / 0.80
    assert f10["target_minor"] == f20["target_minor"] == 2224              # target unchanged at 30%


def test_bad_inputs(client, auth, tuna):
    pid = tuna[1]
    r = client.post("/api/v1/simulate", headers=auth,
                    json={"product_id": pid, "as_of": str(AS_OF), "margin_target_pct": "50"})
    assert r.status_code == 422 and "max_pct" in r.json()["detail"]        # product max margin is 45%
    r = client.post("/api/v1/simulate", headers=auth, json={"product_id": str(uuid.uuid4())})
    assert r.status_code == 404


def test_simulate_writes_nothing(client, auth, tuna, admin_db):
    tid, pid = tuna
    q = text("SELECT (SELECT count(*) FROM pricing_snapshots WHERE tenant_id = :t),"
             "       (SELECT count(*) FROM audit_log WHERE tenant_id = :t)")
    with admin_db.connect() as c:
        before = tuple(c.execute(q, {"t": tid}).one())
    for kw in ({}, {"skipjack_usd": "1.80"}, {"margin_floor_pct": "10"}, {"exclude_channels": ["oman-retail"]}):
        sim(client, auth, pid, **kw)
    with admin_db.connect() as c:
        assert tuple(c.execute(q, {"t": tid}).one()) == before
