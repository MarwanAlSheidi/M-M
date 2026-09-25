"""Sensitivity sweep: canned tuna envelope vs the frozen whole skipjack purchase price.

    uv run python scripts/sensitivity.py [--from 0.80 --to 1.80 --step 0.10] [--base OMR]

Reads sample_data/canned_tuna_product.json and sample_data/canned_tuna_market.csv, replaces only the
"Frozen whole skipjack tuna" rate, and runs the same engine path the loader's envelope uses
(costing.envelope.compute_envelope, then compare_to_market with the latest price per source).
Nothing is written to the database. FX uses the hardcoded pegs (USD -> OMR 0.3845).
"""
from __future__ import annotations
import argparse
import csv
import json
from dataclasses import replace
from datetime import date
from decimal import Decimal
from pathlib import Path

from costing.currencies import exponent_of
from costing.envelope import (
    CostElement, EnvelopeInputs, MarginConfig, MarketPrice, compare_to_market, compute_envelope,
)
from costing.fx import FxResolver
from costing.money import Money

ROOT = Path(__file__).resolve().parents[1]
PRODUCT = ROOT / "sample_data" / "canned_tuna_product.json"
MARKET = ROOT / "sample_data" / "canned_tuna_market.csv"
SOURCE = "oman-wholesale"
SKIPJACK = "Frozen whole skipjack tuna"
NOTE = """Bangkok skipjack benchmark range (2024-2025): 1.30-1.70 USD/kg
whole frozen FOB. Source: Infofish and Thai Union weekly quotes.
Placeholder pending actual purchase price. Replace
sample_data/canned_tuna_product.json raw material rate when the
real number is known."""


def load_inputs(base: str) -> EnvelopeInputs:
    spec = json.loads(PRODUCT.read_text())
    elements = tuple(CostElement(name=e["name"], unit=e["unit"], rate=Money.from_major(e["rate"], e["currency"]),
                                 qty_per_unit=Decimal(e.get("qty_per_unit") or "1"))
                     for e in spec["cost_elements"])
    m = spec["margin"]
    margin = MarginConfig(Decimal(m["min_pct"]), Decimal(m["target_pct"]),
                          Decimal(m["max_pct"]) if m.get("max_pct") else None)
    fx = FxResolver()
    rates = {c: fx.rate(c, base) for c in {e.rate.currency for e in elements} if c != base}
    return EnvelopeInputs(product_name=spec["name"], base_unit=spec["base_unit"], base_currency=base,
                          cost_elements=elements, margin=margin, rates=rates)


def load_market() -> list[MarketPrice]:
    with MARKET.open(newline="") as f:
        # per-row source when the CSV has the column (multi-channel), else the single legacy source
        return [MarketPrice(r.get("source") or SOURCE, Money.from_major(r["price_major"], r["currency"]), r["unit"],
                            date.fromisoformat(r["observed_at"])) for r in csv.DictReader(f)]


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--from", dest="lo", type=Decimal, default=Decimal("0.80"))
    ap.add_argument("--to", dest="hi", type=Decimal, default=Decimal("1.80"))
    ap.add_argument("--step", type=Decimal, default=Decimal("0.10"))
    ap.add_argument("--base", default="OMR", help="tenant base currency (default OMR, the example tenant)")
    args = ap.parse_args(argv)

    inp, market = load_inputs(args.base), load_market()
    if not any(e.name == SKIPJACK for e in inp.cost_elements):
        raise SystemExit(f"no cost element named {SKIPJACK!r} in {PRODUCT}")
    rates = {**inp.rates, **{p.price.currency: FxResolver().rate(p.price.currency, args.base)
                             for p in market if p.price.currency != args.base}}
    exp = exponent_of(args.base)
    fmt = lambda minor: f"{Decimal(minor) / 10 ** exp:.{exp}f}"    # noqa: E731

    print(NOTE)
    print()
    sources = sorted({p.source for p in market})
    print(f"all amounts {args.base} per {inp.base_unit} except skipjack_usd; market_ref = median of the latest "
          f"price per source ({', '.join(sources)})")
    cols = ["skipjack_usd", "unit_cost", "floor", "target", "ceiling", "market_ref", "position"]
    print(" | ".join(cols))
    price = args.lo
    while price <= args.hi:
        els = tuple(replace(e, rate=Money.from_major(price, "USD")) if e.name == SKIPJACK else e
                    for e in inp.cost_elements)
        env = compute_envelope(replace(inp, cost_elements=els))
        cmp = compare_to_market(env, market, rates)
        print(" | ".join([f"{price:.2f}", fmt(env.unit_cost_minor), fmt(env.floor_minor), fmt(env.target_minor),
                          fmt(env.ceiling_minor), fmt(cmp.market_reference_minor), cmp.position]))
        price += args.step


if __name__ == "__main__":
    main()
