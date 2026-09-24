"""Pure-engine regression on exported golden deals (no DB).
Collects 0 cases until scripts/export_golden.py has run."""
import json
from pathlib import Path
import pytest

from costing.engine import compute_landed
from costing.serialize import from_json

GOLDEN = Path(__file__).parent / "golden"


@pytest.mark.parametrize("path", sorted(GOLDEN.glob("*.json")) if GOLDEN.exists() else [])
def test_golden_fixture(path):
    data = json.loads(path.read_text())
    result = compute_landed(from_json(data["inputs"]))
    exp = data["expected"]["landed_cost"]
    assert result.landed_cost.amount_minor == exp["amount_minor"]
    assert result.landed_cost.currency == exp["currency"]
    want = {l["type"]: l["amount_minor"] for l in data["expected"]["lines"]}
    got = {l.type: l.amount.amount_minor for l in result.lines}
    assert got == want
