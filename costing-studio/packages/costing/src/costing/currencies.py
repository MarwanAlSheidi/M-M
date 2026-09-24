from __future__ import annotations
from decimal import Decimal
from typing import Dict
_CURRENCIES: Dict[str, int] = {
    "OMR": 3, "KWD": 3, "BHD": 3, "JOD": 3, "TND": 3, "LYD": 3,
    "USD": 2, "EUR": 2, "GBP": 2, "AED": 2, "SAR": 2, "QAR": 2,
    "THB": 2, "IDR": 2, "VND": 0, "JPY": 0, "KRW": 0, "PHP": 2,
    "MYR": 2, "SGD": 2, "INR": 2, "PKR": 2, "BDT": 2,
}
_USD_PEGS: Dict[str, Decimal] = {
    "OMR": Decimal("0.3845"), "AED": Decimal("3.6725"), "SAR": Decimal("3.7500"),
    "QAR": Decimal("3.6400"), "BHD": Decimal("0.3760"),
}
def exponent_of(code):
    try: return _CURRENCIES[code]
    except KeyError: raise ValueError(f"Unknown currency: {code}") from None
def is_pegged_to_usd(code): return code in _USD_PEGS
def usd_peg_rate(code):
    if code not in _USD_PEGS: raise ValueError(f"{code} is not USD-pegged")
    return _USD_PEGS[code]
KNOWN_CURRENCIES = frozenset(_CURRENCIES)
