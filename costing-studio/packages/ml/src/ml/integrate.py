"""Guarded, immutable overlay of ML predictions onto DealInputs."""
from __future__ import annotations
import dataclasses
from decimal import Decimal
from typing import Optional

from costing.models import DealInputs
from costing.money import Money

from .guard import GuardResult, guard


@dataclasses.dataclass
class AppliedPrediction:
    field: str
    value: Decimal
    guard: GuardResult


def apply_ml_predictions(
    inp: DealInputs, *,
    predicted_purchase_major: Optional[Decimal] = None,
    predicted_freight_per_unit_major: Optional[Decimal] = None,
    predicted_yield: Optional[Decimal] = None,
    purchase_bounds: Optional[tuple] = None,
    freight_bounds: Optional[tuple] = None,
    yield_bounds: Optional[tuple] = None,
    formula_purchase_major: Optional[Decimal] = None,
    latest_spot_purchase: Optional[Decimal] = None,
) -> tuple[DealInputs, list[AppliedPrediction]]:
    overrides: dict = {}
    ml_fields: set = set(inp.ml_fields)
    log: list[AppliedPrediction] = []

    if predicted_purchase_major is not None:
        lo, hi = purchase_bounds or (None, None)
        g = guard(predicted_purchase_major, formula_purchase_major, lo, hi,
                  latest_spot=latest_spot_purchase)
        overrides["purchase_unit_price_major"] = g.final_value
        ml_fields.add("purchase_unit_price_major")
        log.append(AppliedPrediction("purchase_unit_price_major", g.final_value, g))

    if predicted_freight_per_unit_major is not None:
        lo, hi = freight_bounds or (None, None)
        g = guard(predicted_freight_per_unit_major, None, lo, hi)
        overrides["freight_total"] = Money.from_major(g.final_value, inp.freight_total.currency) * inp.quantity
        ml_fields.add("freight_total")
        log.append(AppliedPrediction("freight_total", g.final_value, g))

    if predicted_yield is not None:
        lo, hi = yield_bounds or (None, None)
        g = guard(predicted_yield, None, lo, hi)
        y = min(max(g.final_value, Decimal("0.0001")), Decimal("1"))
        overrides["yield_pct"] = y
        ml_fields.add("yield_pct")
        log.append(AppliedPrediction("yield_pct", y, g))

    if not overrides:
        return inp, log
    out = dataclasses.replace(inp, locked_rates=dict(inp.locked_rates), ml_fields=ml_fields, **overrides)
    return out, log
