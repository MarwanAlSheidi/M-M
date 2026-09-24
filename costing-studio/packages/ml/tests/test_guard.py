from decimal import Decimal
from ml.guard import guard


def test_accepts_within_tolerance():
    assert guard(Decimal("100"), Decimal("105"), Decimal("90"), Decimal("120")).accepted


def test_rejects_outside_15pct():
    r = guard(Decimal("130"), Decimal("100"), Decimal("90"), Decimal("140"))
    assert not r.accepted and r.final_value == Decimal("100")


def test_rejects_outside_hist_range():
    r = guard(Decimal("100"), Decimal("100"), Decimal("90"), Decimal("95"))
    assert not r.accepted and r.final_value == Decimal("100")


def test_falls_back_to_latest_spot_without_formula():
    r = guard(Decimal("100"), None, Decimal("10"), Decimal("20"), latest_spot=Decimal("18"))
    assert not r.accepted and r.final_value == Decimal("18")


def test_falls_back_to_midpoint_when_no_formula_no_spot():
    r = guard(Decimal("100"), None, Decimal("10"), Decimal("20"))
    assert not r.accepted and r.final_value == Decimal("15")
