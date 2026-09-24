from datetime import date
from costing.models import DealInputs
from costing.money import Money
from costing.serialize import from_json, to_json
import json


def test_round_trip_all_fields(base_deal_kwargs):
    inp = DealInputs(**{**base_deal_kwargs,
                        "origin_charges": Money.from_major("120", "USD"),
                        "freight_total": Money.from_major("2700", "USD"),
                        "ml_fields": {"purchase_unit_price_major", "yield_pct"},
                        "deal_date": date(2024, 6, 15)})
    got = from_json(json.loads(json.dumps(to_json(inp))))
    for f in inp.__dataclass_fields__:
        assert getattr(got, f) == getattr(inp, f), f
