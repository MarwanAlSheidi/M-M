from __future__ import annotations
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from .currencies import KNOWN_CURRENCIES, exponent_of
@dataclass(frozen=True)
class Money:
    amount_minor: int
    currency: str
    def __post_init__(self):
        if isinstance(self.amount_minor, bool) or not isinstance(self.amount_minor, int):
            raise TypeError("amount_minor must be int (not bool)")
        if self.currency not in KNOWN_CURRENCIES:
            raise ValueError(f"Unknown currency: {self.currency}")
    @classmethod
    def from_major(cls, amount, currency):
        exp = exponent_of(currency)
        dec = (Decimal(amount) * (Decimal(10) ** exp)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        return cls(int(dec), currency)
    @property
    def major(self):
        return Decimal(self.amount_minor) / (Decimal(10) ** exponent_of(self.currency))
    def _check(self, o):
        if self.currency != o.currency: raise ValueError(f"Currency mismatch: {self.currency} vs {o.currency}")
    def __add__(self, o): self._check(o); return Money(self.amount_minor + o.amount_minor, self.currency)
    def __sub__(self, o): self._check(o); return Money(self.amount_minor - o.amount_minor, self.currency)
    def __mul__(self, f):
        prod = Decimal(self.amount_minor) * Decimal(f)
        return Money(int(prod.quantize(Decimal("1"), ROUND_HALF_UP)), self.currency)
    def __neg__(self): return Money(-self.amount_minor, self.currency)
