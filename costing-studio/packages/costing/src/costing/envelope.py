"""Pricing envelope: cost elements -> floor / target / ceiling -> position vs market.

Product-agnostic: a product is data (a base unit plus cost-element rows), never a class.

Conventions (agreed):
- Margin is on price: price = unit_cost / (1 - margin_pct).
- floor = min_pct, target = target_pct, ceiling = max_pct; when max_pct is None the
  ceiling falls back to target + (target - floor).
- Money stays in integer minor units; each cost line is converted to the base currency
  with ROUND_HALF_UP, then lines are summed.
- Positions (M = market reference, per product unit, in the envelope currency):
    M < unit_cost               -> not_viable  (market does not cover cost)
    unit_cost <= M < floor      -> too_low     (covers cost, misses min margin)
    floor <= M <= ceiling       -> attractive
    M > ceiling                 -> too_high    (market above the max-margin ceiling)
"""
from __future__ import annotations
from dataclasses import dataclass, field, fields
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, Literal, Mapping, Optional, Sequence

from .currencies import exponent_of
from .money import Money
from .serialize import _dec, _enc
from .units import convert_mass

Position = Literal["attractive", "too_high", "too_low", "not_viable"]
POSITIONS: tuple[str, ...] = ("attractive", "too_high", "too_low", "not_viable")
_ONE = Decimal("1")


@dataclass(frozen=True)
class CostElement:
    """One cost row: `rate` per `unit` of this element, `qty_per_unit` element units per
    product unit (1 when the element is priced per product unit)."""
    name: str
    unit: str
    rate: Money
    qty_per_unit: Decimal = _ONE


@dataclass(frozen=True)
class MarginConfig:
    min_pct: Decimal
    target_pct: Decimal
    max_pct: Optional[Decimal] = None

    def __post_init__(self):
        if not (Decimal(0) <= self.min_pct < self.target_pct < _ONE):
            raise ValueError(f"margins must satisfy 0 <= min < target < 1 "
                             f"(got {self.min_pct}, {self.target_pct})")
        if self.max_pct is not None and not (self.target_pct < self.max_pct < _ONE):
            raise ValueError(f"max_pct must satisfy target < max < 1 (got {self.max_pct})")


@dataclass(frozen=True)
class EnvelopeInputs:
    """Everything compute_envelope needs; stored as pricing_snapshots.inputs_snapshot."""
    product_name: str
    base_unit: str
    base_currency: str
    cost_elements: tuple[CostElement, ...]
    margin: MarginConfig
    rates: Dict[str, Decimal] = field(default_factory=dict)   # 1 unit of ccy = rate x base
    as_of: Optional[date] = None


@dataclass(frozen=True)
class CostLine:
    name: str
    amount: Money            # per product unit, base currency


@dataclass(frozen=True)
class Envelope:
    currency: str
    unit: str
    unit_cost_minor: int
    floor_minor: int
    target_minor: int
    ceiling_minor: int
    ceiling_source: Literal["max_pct", "mirror"]
    lines: tuple[CostLine, ...]


@dataclass(frozen=True)
class MarketPrice:
    source: str
    price: Money
    unit: str
    observed_at: date


@dataclass(frozen=True)
class MarketComparison:
    position: Position
    market_reference_minor: int
    gap_to_floor: int
    gap_to_target: int
    gap_to_ceiling: int
    currency: str
    sources_used: tuple[str, ...]


def _round(v: Decimal) -> int:
    return int(v.quantize(_ONE, ROUND_HALF_UP))


def to_base(m: Money, base: str, rates: Mapping[str, Decimal]) -> Money:
    if m.currency == base:
        return m
    if m.currency not in rates:
        raise ValueError(f"no rate for {m.currency} -> {base}")
    scale = Decimal(10) ** (exponent_of(base) - exponent_of(m.currency))
    return Money(_round(Decimal(m.amount_minor) * Decimal(rates[m.currency]) * scale), base)


def price_for_margin(unit_cost_minor: int, pct: Decimal) -> int:
    return _round(Decimal(unit_cost_minor) / (_ONE - pct))


def compute_envelope(inp: EnvelopeInputs) -> Envelope:
    if not inp.cost_elements:
        raise ValueError(f"{inp.product_name}: no cost elements")
    lines = []
    for e in inp.cost_elements:
        if e.qty_per_unit < 0:
            raise ValueError(f"{e.name}: qty_per_unit must be >= 0")
        line = to_base(e.rate * e.qty_per_unit, inp.base_currency, inp.rates)   # round per line
        lines.append(CostLine(e.name, line))
    unit_cost = sum(l.amount.amount_minor for l in lines)
    if unit_cost <= 0:
        raise ValueError(f"{inp.product_name}: unit cost must be positive")
    m = inp.margin
    floor = price_for_margin(unit_cost, m.min_pct)
    target = price_for_margin(unit_cost, m.target_pct)
    if m.max_pct is not None:
        ceiling, src = price_for_margin(unit_cost, m.max_pct), "max_pct"
    else:
        ceiling, src = target + (target - floor), "mirror"
    return Envelope(currency=inp.base_currency, unit=inp.base_unit, unit_cost_minor=unit_cost,
                    floor_minor=floor, target_minor=target, ceiling_minor=ceiling,
                    ceiling_source=src, lines=tuple(lines))


def _per_product_unit(p: MarketPrice, env: Envelope, rates: Mapping[str, Decimal]) -> int:
    base = to_base(p.price, env.currency, rates).amount_minor
    if p.unit == env.unit:
        return base
    # Only mass units convert; anything else must be quoted in the product's own unit.
    # price per p.unit -> price per env.unit: multiply by how many p.units one env.unit holds
    return _round(Decimal(base) * convert_mass(_ONE, env.unit, p.unit))


def position_of(env: Envelope, market_minor: int) -> Position:
    if market_minor < env.unit_cost_minor:
        return "not_viable"
    if market_minor < env.floor_minor:
        return "too_low"
    if market_minor <= env.ceiling_minor:
        return "attractive"
    return "too_high"


def compare_to_market(env: Envelope, market_prices: Sequence[MarketPrice],
                      rates: Optional[Mapping[str, Decimal]] = None) -> MarketComparison:
    """Reference = median of the latest observation per source (per product unit, envelope ccy)."""
    latest: Dict[str, MarketPrice] = {}
    for p in market_prices:
        if p.source not in latest or p.observed_at > latest[p.source].observed_at:
            latest[p.source] = p
    if not latest:
        raise ValueError("no market prices")
    vals = sorted(_per_product_unit(p, env, rates or {}) for p in latest.values())
    mid = len(vals) // 2
    ref = vals[mid] if len(vals) % 2 else _round(Decimal(vals[mid - 1] + vals[mid]) / 2)
    return MarketComparison(position=position_of(env, ref), market_reference_minor=ref,
                            gap_to_floor=ref - env.floor_minor, gap_to_target=ref - env.target_minor,
                            gap_to_ceiling=ref - env.ceiling_minor, currency=env.currency,
                            sources_used=tuple(sorted(latest)))


def inputs_to_json(inp: EnvelopeInputs) -> dict:
    return {
        "product_name": inp.product_name, "base_unit": inp.base_unit, "base_currency": inp.base_currency,
        "cost_elements": [{f.name: _enc(getattr(e, f.name)) for f in fields(e)} for e in inp.cost_elements],
        "margin": {f.name: _enc(getattr(inp.margin, f.name)) for f in fields(inp.margin)},
        "rates": _enc(inp.rates), "as_of": _enc(inp.as_of),
    }


def inputs_from_json(d: dict) -> EnvelopeInputs:
    return EnvelopeInputs(
        product_name=d["product_name"], base_unit=d["base_unit"], base_currency=d["base_currency"],
        cost_elements=tuple(CostElement(**{k: _dec(v) for k, v in e.items()}) for e in d["cost_elements"]),
        margin=MarginConfig(**{k: _dec(v) for k, v in d["margin"].items()}),
        rates={k: Decimal(str(v)) for k, v in (_dec(d.get("rates")) or {}).items()},
        as_of=_dec(d.get("as_of")),
    )


def envelope_to_json(env: Envelope) -> dict:
    return {"currency": env.currency, "unit": env.unit, "unit_cost_minor": env.unit_cost_minor,
            "floor_minor": env.floor_minor, "target_minor": env.target_minor,
            "ceiling_minor": env.ceiling_minor, "ceiling_source": env.ceiling_source,
            "lines": [{"name": l.name, "amount_minor": l.amount.amount_minor} for l in env.lines]}


__all__ = [
    "CostElement", "MarginConfig", "EnvelopeInputs", "Envelope", "MarketPrice", "MarketComparison",
    "CostLine", "POSITIONS", "compute_envelope", "compare_to_market", "position_of",
    "price_for_margin", "to_base", "inputs_to_json", "inputs_from_json", "envelope_to_json",
]
