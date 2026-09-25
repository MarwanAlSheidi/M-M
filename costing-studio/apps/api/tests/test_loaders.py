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
    assert run("scripts/load_product.py", f).stderr.strip() == f"error: product {name!r} already exists"

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
    assert n == 1 and snaps[:2] == ["load_product", "load_market_prices"]


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
