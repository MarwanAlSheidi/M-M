"""Reject ML outputs outside ±15% of the formula value or the historical range."""
from __future__ import annotations
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional


@dataclass
class GuardResult:
    accepted: bool
    reason: str
    final_value: Decimal


def _pct_delta(a: Decimal, b: Decimal) -> Decimal:
    if b == 0:
        return Decimal("0") if a == 0 else Decimal("Infinity")
    return abs(a - b) / abs(b)


def guard(ml_value: Decimal, formula_value: Optional[Decimal],
          hist_lo: Optional[Decimal], hist_hi: Optional[Decimal],
          pct_tolerance: Decimal = Decimal("0.15"),
          latest_spot: Optional[Decimal] = None) -> GuardResult:
    if formula_value is not None and formula_value != 0:
        if _pct_delta(ml_value, formula_value) > pct_tolerance:
            return GuardResult(False, "outside ±15% of formula", formula_value)

    if hist_lo is not None and hist_hi is not None:
        if not (hist_lo <= ml_value <= hist_hi):
            if formula_value is not None:
                fallback = formula_value
            elif latest_spot is not None:
                fallback = latest_spot
            else:
                fallback = (hist_lo + hist_hi) / Decimal("2")
            return GuardResult(False, "outside historical range", fallback)

    return GuardResult(True, "accepted", ml_value)
