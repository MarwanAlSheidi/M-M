from decimal import Decimal, ROUND_HALF_UP
from costing.engine import _to_base, compute_landed
from costing.fx import FxResolver
from costing.models import DealInputs
from costing.money import Money


def test_usd_omr_usd_roundtrip():
    start = Money.from_major("1000.00", "USD")
    o = _to_base(start, {"USD": FxResolver().rate("USD", "OMR")}, "OMR")
    back = _to_base(o, {"OMR": FxResolver().rate("OMR", "USD")}, "USD")
    assert abs(back.amount_minor - start.amount_minor) <= 1


def test_jpy_supplier_zero_exponent(base_deal_kwargs):
    fx = FxResolver({"JPY/USD": Decimal("0.0067")})
    r = compute_landed(DealInputs(**{**base_deal_kwargs, "currency": "JPY",
                                     "purchase_unit_price_major": Decimal("480"),
                                     "locked_rates": {"JPY": fx.rate("JPY", "OMR")}}))
    purchase = next(l for l in r.lines if l.type == "purchase").amount.amount_minor
    expected = int((Decimal("8640000") * Decimal("0.0067") * Decimal("0.3845") * 1000)
                   .quantize(Decimal("1"), ROUND_HALF_UP))
    assert purchase == expected


def test_pegs_pinned():
    fx = FxResolver()
    for ccy, v in [("OMR", "0.3845"), ("AED", "3.6725"), ("SAR", "3.7500"),
                   ("QAR", "3.6400"), ("BHD", "0.3760")]:
        assert fx.rate("USD", ccy) == Decimal(v)
