from decimal import Decimal
from costing.fx import FxResolver
from costing.models import DealInputs
from costing.money import Money
from ml.integrate import apply_ml_predictions


def _inp():
    return DealInputs(product_sku="X", quantity=Decimal("1000"), base_unit="kg",
                      yield_pct=Decimal("0.55"), purchase_unit_price_major=Decimal("3.20"),
                      currency="USD", incoterm="CFR",
                      locked_rates={"USD": FxResolver().rate("USD", "OMR")})


def test_overlay_is_immutable_and_tagged():
    inp = _inp()
    out, log = apply_ml_predictions(inp, predicted_purchase_major=Decimal("3.30"),
                                    purchase_bounds=(Decimal("2.8"), Decimal("3.9")))
    assert inp.purchase_unit_price_major == Decimal("3.20")
    assert out.purchase_unit_price_major == Decimal("3.30")
    assert "purchase_unit_price_major" in out.ml_fields
    assert log[0].guard.accepted


def test_yield_clamped():
    out, _ = apply_ml_predictions(_inp(), predicted_yield=Decimal("1.4"))
    assert out.yield_pct == Decimal("1")
