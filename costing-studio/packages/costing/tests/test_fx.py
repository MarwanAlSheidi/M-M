from decimal import Decimal
import pytest
from costing.fx import FxResolver


def test_thb_to_omr_via_peg():
    fx = FxResolver({"THB/USD": Decimal("0.0278")})
    assert fx.rate("THB", "OMR") == Decimal("0.0278") * Decimal("0.3845")


def test_missing_market_rate():
    with pytest.raises(ValueError):
        FxResolver().rate("THB", "OMR")


def test_identity():
    assert FxResolver().rate("OMR", "OMR") == Decimal("1")
