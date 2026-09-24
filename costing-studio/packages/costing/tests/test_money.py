from decimal import Decimal
import pytest
from costing.money import Money


def test_from_major_exponents():
    assert Money.from_major("1.234", "OMR").amount_minor == 1234
    assert Money.from_major("1.23", "USD").amount_minor == 123
    assert Money.from_major("480", "JPY").amount_minor == 480


def test_half_up():
    assert Money.from_major("0.0005", "OMR").amount_minor == 1


def test_rejects_bool_and_float():
    with pytest.raises(TypeError):
        Money(True, "OMR")
    with pytest.raises(TypeError):
        Money(1.5, "OMR")


def test_currency_mismatch():
    with pytest.raises(ValueError):
        Money(1, "OMR") + Money(1, "USD")


def test_major():
    assert Money(26_720_146, "OMR").major == Decimal("26720.146")
