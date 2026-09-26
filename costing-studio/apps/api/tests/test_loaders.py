"""scripts/load_product.py and scripts/load_market_prices.py against a migrated + seeded DB."""
from __future__ import annotations
import json
import os
import subprocess
import sys
import uuid
from datetime import date, timedelta
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

ADMIN_URL = os.environ.get("ADMIN_DATABASE_URL")
ROOT = Path(__file__).resolve().parents[3]
# The api Docker image copies only apps/ and packages/, so the loaders are exercised from a host checkout.
pytestmark = pytest.mark.skipif(
    not (ADMIN_URL and os.environ.get("DATABASE_URL") and (ROOT / "scripts" / "load_product.py").exists()),
    reason="DB URLs not set or scripts/ not in this checkout")
EXAMPLE_FILE = ROOT / "sample_data" / "example_product.json"
EXAMPLE = json.loads(EXAMPLE_FILE.read_text()) if EXAMPLE_FILE.exists() else {}


def run(*args):
    return subprocess.run([sys.executable, *(str(a) for a in args)], cwd=ROOT, capture_output=True, text=True,
                          env={**os.environ})


@pytest.fixture
def product_file(tmp_path):
    name = f"loader-test-{uuid.uuid4().hex[:8]}"
    f = tmp_path / "p.json"
    f.write_text(json.dumps({**EXAMPLE, "name": name}))
    yield name, f
    eng = create_engine(ADMIN_URL)
    with eng.begin() as c:
        c.execute(text("DELETE FROM products WHERE name = :n"), {"n": name})
    eng.dispose()


def test_load_product_then_prices(product_file, tmp_path):
    name, f = product_file
    r = run("scripts/load_product.py", f)
    assert r.returncode == 0, r.stderr
    # hand-checked: 0.137 + 0.026 + 0.023 + 0.012 + 0.070 + 0.004 (1 US cent) = 0.272 OMR per loaf
    for line in ("unit cost                           0.272 OMR", "floor                               0.320 OMR",
                 "target                              0.389 OMR", "ceiling (max_pct)                   0.495 OMR",
                 "market: no fresh prices"):
        assert line in r.stdout, r.stdout
    again = run("scripts/load_product.py", f)                  # same file again: a no-op, not a refusal
    assert again.returncode == 0 and "unchanged" in again.stdout, again.stderr

    csv = tmp_path / "prices.csv"
    csv.write_text("observed_at,price_major,currency,unit\n" + "\n".join(
        f"{date.today() - timedelta(days=d)},{p},OMR,loaf" for d, p in ((1, "0.300"), (3, "0.310"))))
    r = run("scripts/load_market_prices.py", name, "shop-audit", csv)
    assert r.returncode == 0, r.stderr
    assert "inserted 2 of 2 rows" in r.stdout and "0.300 OMR  [too_low]" in r.stdout, r.stdout
    assert "inserted 0 of 2 rows" in run("scripts/load_market_prices.py", name, "shop-audit", csv).stdout

    eng = create_engine(ADMIN_URL)
    with eng.connect() as c:
        n = c.execute(text("""SELECT count(*) FROM audit_log a JOIN products p ON a.entity_id = p.id::text
                              WHERE p.name = :n"""), {"n": name}).scalar()
        snaps = c.execute(text("""SELECT computed_by FROM pricing_snapshots s JOIN products p ON p.id = s.product_id
                                  WHERE p.name = :n ORDER BY computed_at"""), {"n": name}).scalars().all()
    eng.dispose()
    assert n == 1 and snaps == ["load_market_prices"]        # the product loader only previews the envelope


def test_loaders_refuse_bad_input_without_writing(product_file, tmp_path):
    name, f = product_file
    spec = json.loads(f.read_text())
    spec["cost_elements"][2].update(unit="kWh", rate="0.0255", qty_per_unit="0.9")     # 4 decimals of OMR
    f.write_text(json.dumps(spec))
    r = run("scripts/load_product.py", f)
    assert r.returncode != 0 and "would be rounded" in r.stderr
    spec["cost_elements"][2].update(rate="0.025")
    spec["margin"] = {"min_pct": "0.30", "target_pct": "0.15"}
    f.write_text(json.dumps(spec))
    r = run("scripts/load_product.py", f)
    assert r.returncode != 0 and "min < target" in r.stderr
    eng = create_engine(ADMIN_URL)
    with eng.connect() as c:
        assert c.execute(text("SELECT count(*) FROM products WHERE name = :n"), {"n": name}).scalar() == 0
    eng.dispose()
    r = run("scripts/load_market_prices.py", "no-such-product", "x", ROOT / "sample_data" / "example_market_prices.csv")
    assert r.returncode != 0 and "no product named" in r.stderr


def test_market_loader_upserts_one_source_row_per_channel_with_type(product_file, tmp_path):
    name, f = product_file
    assert run("scripts/load_product.py", f).returncode == 0
    d1, d2 = date.today() - timedelta(days=1), date.today() - timedelta(days=2)
    csv = tmp_path / "channels.csv"
    csv.write_text("observed_at,source,channel_type,price_major,currency,unit\n"
                   f"{d2},wholesale-a,trade,0.300,OMR,loaf\n{d1},wholesale-a,trade,0.310,OMR,loaf\n"
                   f"{d1},shop-b,retail,0.450,OMR,loaf\n")
    r = run("scripts/load_market_prices.py", name, csv)
    assert r.returncode == 0, r.stderr
    eng = create_engine(ADMIN_URL)
    q = text("""SELECT ms.source, ms.channel_type, ms.frequency, ms.staleness_days FROM market_sources ms
                JOIN products p ON p.id = ms.product_id WHERE p.name = :n ORDER BY ms.source""")
    with eng.connect() as c:
        assert [tuple(x) for x in c.execute(q, {"n": name})] == [
            ("shop-b", "retail", "weekly", 30), ("wholesale-a", "trade", "weekly", 30)]
    bad = tmp_path / "bad.csv"
    bad.write_text("observed_at,source,channel_type,price_major,currency,unit\n"
                   f"{d2},wholesale-a,trade,0.300,OMR,loaf\n{d1},wholesale-a,export,0.310,OMR,loaf\n")
    r = run("scripts/load_market_prices.py", name, bad)
    assert r.returncode != 0 and "conflicting channel_type" in r.stderr
    with eng.connect() as c:                                               # nothing changed by the failed load
        assert [x[1] for x in c.execute(q, {"n": name})] == ["retail", "trade"]
    eng.dispose()


def _state(name):
    """Everything a product load can write, for before/after comparisons."""
    eng = create_engine(ADMIN_URL)
    with eng.connect() as c:
        pid = c.execute(text("SELECT id FROM products WHERE name = :n"), {"n": name}).scalar()
        q = {"p": pid}
        out = {
            "attributes": c.execute(text("SELECT attributes FROM products WHERE id = :p"), q).scalar(),
            "elements": c.execute(text("""SELECT ce.name, ce.rate_minor, ce.valid_from, ce.valid_to, b.qty_per_unit
                                            FROM cost_elements ce LEFT JOIN product_bom b ON b.cost_element_id = ce.id
                                           WHERE ce.product_id = :p ORDER BY ce.name, ce.valid_from"""), q).all(),
            "margins": c.execute(text("SELECT min_pct, target_pct, max_pct, valid_from, valid_to FROM margin_config "
                                      "WHERE product_id = :p ORDER BY valid_from"), q).all(),
            "audit": c.execute(text("SELECT count(*) FROM audit_log WHERE tenant_id = "
                                    "(SELECT tenant_id FROM products WHERE id = :p)"), q).scalar(),
            "snapshots": c.execute(text("SELECT count(*) FROM pricing_snapshots WHERE product_id = :p"), q).scalar(),
        }
    eng.dispose()
    return out


def test_reload_identical_json_changes_nothing(product_file):
    name, f = product_file
    assert run("scripts/load_product.py", f).returncode == 0
    before = _state(name)
    r = run("scripts/load_product.py", f)
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip().endswith("unchanged"), r.stdout
    assert _state(name) == before


def test_reload_with_one_modified_attribute_updates_only_that(product_file, tmp_path):
    name, f = product_file
    assert run("scripts/load_product.py", f).returncode == 0
    before = _state(name)
    changed = tmp_path / "changed.json"
    changed.write_text(json.dumps({**EXAMPLE, "name": name,
                                   "attributes": {**EXAMPLE["attributes"], "shelf_life_days": 5}}))
    r = run("scripts/load_product.py", changed)
    assert r.returncode == 0, r.stderr
    assert "attribute modified: shelf_life_days: 4 -> 5" in r.stdout, r.stdout
    after = _state(name)
    assert after["attributes"] == {**before["attributes"], "shelf_life_days": 5}
    assert (after["elements"], after["margins"]) == (before["elements"], before["margins"])   # nothing versioned
    assert after["audit"] == before["audit"] + 1                                               # the one update


def test_dry_run_prints_the_diff_and_writes_nothing(product_file, tmp_path):
    name, f = product_file
    assert run("scripts/load_product.py", f).returncode == 0
    before = _state(name)
    attrs = {k: v for k, v in EXAMPLE["attributes"].items() if k != "weight_g"}
    elements = [{**e, "rate": "0.400"} if e["name"] == "flour" else e for e in EXAMPLE["cost_elements"]]
    changed = tmp_path / "changed.json"
    changed.write_text(json.dumps({**EXAMPLE, "name": name, "cost_elements": elements,
                                   "margin": {**EXAMPLE["margin"], "target_pct": "0.32"},
                                   "attributes": {**attrs, "shelf_life_days": 5, "origin": "OM"}}))
    r = run("scripts/load_product.py", changed, "--dry-run")
    assert r.returncode == 0, r.stderr
    assert r.stdout.splitlines() == [
        "dry run, nothing written:",
        f"existing product {name!r}",
        "  attribute added:    origin = 'OM'",
        "  attribute removed:  weight_g (was 600)",
        "  attribute modified: shelf_life_days: 4 -> 5",
        "  cost element versioned: flour (rate 0.380 OMR -> 0.400 OMR)",
        "  margin versioned: min/target/max 15%/30%/45% -> 15%/32%/45%",
    ], r.stdout
    assert _state(name) == before
    same = run("scripts/load_product.py", f, "--dry-run")
    assert "attributes: unchanged" in same.stdout and "cost elements: unchanged" in same.stdout \
        and "margin: unchanged" in same.stdout, same.stdout


def test_market_reload_with_identical_csv_skips_the_envelope(product_file, tmp_path):
    name, f = product_file
    assert run("scripts/load_product.py", f).returncode == 0
    csv = tmp_path / "prices.csv"
    csv.write_text("observed_at,price_major,currency,unit\n" + "\n".join(
        f"{date.today() - timedelta(days=d)},{p},OMR,loaf" for d, p in ((1, "0.300"), (3, "0.310"))))
    snaps = lambda: _state(name)["snapshots"]      # noqa: E731
    s0 = snaps()
    first = run("scripts/load_market_prices.py", name, "shop-audit", csv)
    assert first.returncode == 0 and "inserted 2 of 2 rows" in first.stdout, first.stderr
    assert snaps() == s0 + 1                                                   # first run: one snapshot
    second = run("scripts/load_market_prices.py", name, "shop-audit", csv)
    assert second.returncode == 0, second.stderr
    assert "inserted 0 of 2 rows" in second.stdout and "no new rows, skipping envelope" in second.stdout
    assert "envelope per" not in second.stdout, second.stdout
    assert snaps() == s0 + 1                                                   # second run: none


def _undated(name):
    """The example product with no valid_from anywhere, so every version starts today."""
    return {**EXAMPLE, "name": name,
            "cost_elements": [{k: v for k, v in e.items() if k != "valid_from"} for e in EXAMPLE["cost_elements"]],
            "margin": {k: v for k, v in EXAMPLE["margin"].items() if k != "valid_from"}}


def _api(name):
    """(client, auth headers, product id) for the loader's tenant, with a forged token like test_simulate."""
    import jwt
    from fastapi.testclient import TestClient
    from costing_api.main import app
    from costing_api.settings import settings
    tok = jwt.encode({"sub": str(uuid.uuid4()), "tenant_id": "11111111-1111-1111-1111-111111111111", "role": "admin"},
                     settings.jwt_secret, algorithm="HS256")
    eng = create_engine(ADMIN_URL)
    with eng.connect() as c:
        pid = str(c.execute(text("SELECT id FROM products WHERE name = :n"), {"n": name}).scalar())
    eng.dispose()
    return TestClient(app), {"Authorization": f"Bearer {tok}"}, pid


def _flour_changed(name, tmp_path):
    spec = _undated(name)
    spec["cost_elements"] = [{**e, "rate": "0.400"} if e["name"] == "flour" else e for e in spec["cost_elements"]]
    f = tmp_path / "flour.json"
    f.write_text(json.dumps(spec))
    return f


@pytest.mark.skipif(not os.environ.get("JWT_SECRET"), reason="JWT_SECRET not set")
def test_same_day_change_updates_the_version_in_place_before_any_snapshot(product_file, tmp_path):
    name, f = product_file
    f.write_text(json.dumps(_undated(name)))
    first = run("scripts/load_product.py", f)
    assert first.returncode == 0 and "preview, not saved" in first.stdout, first.stderr
    client, auth, pid = _api(name)
    assert client.post("/api/v1/simulate", headers=auth, json={"product_id": pid}).status_code == 200
    before = _state(name)
    assert before["snapshots"] == 0                            # neither the load nor simulate saved one

    r = run("scripts/load_product.py", _flour_changed(name, tmp_path))
    assert r.returncode == 0, r.stderr
    assert "updated version for flour" in r.stdout, r.stdout
    after = _state(name)
    assert len(after["elements"]) == len(before["elements"])   # replaced, not versioned
    flour = [e for e in after["elements"] if e.name == "flour"]
    assert len(flour) == 1 and flour[0].rate_minor == 400 and flour[0].valid_to is None
    assert float(flour[0].qty_per_unit) == float(next(e for e in EXAMPLE["cost_elements"]
                                                      if e["name"] == "flour")["qty_per_unit"])
    assert after["margins"] == before["margins"] and after["snapshots"] == 0


@pytest.mark.skipif(not os.environ.get("JWT_SECRET"), reason="JWT_SECRET not set")
def test_same_day_change_is_refused_once_a_snapshot_used_the_version(product_file, tmp_path):
    name, f = product_file
    f.write_text(json.dumps(_undated(name)))
    assert run("scripts/load_product.py", f).returncode == 0
    client, auth, pid = _api(name)
    assert client.post("/api/v1/simulate", headers=auth, json={"product_id": pid}).status_code == 200
    # simulate is read-only; the recompute endpoint is what records a snapshot of the current version
    assert client.post("/api/v1/envelope", headers=auth, json={"product_id": pid}).status_code == 200
    before = _state(name)
    assert before["snapshots"] == 1

    r = run("scripts/load_product.py", _flour_changed(name, tmp_path))
    assert r.returncode != 0
    assert r.stderr.strip() == f"error: a cost_elements version starting on or after {date.today()} already exists"
    assert _state(name) == before                              # whole load rolled back
