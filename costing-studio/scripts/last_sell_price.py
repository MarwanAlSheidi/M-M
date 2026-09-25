"""Last viable sell price per market channel for one product. Read-only.

    DATABASE_URL=postgresql+psycopg://costing_app:app_pw@localhost:5432/costing \\
      uv run python scripts/last_sell_price.py "Canned Light Tuna in Sunflower Oil" [--as-of 2026-09-25]

Uses the loader's envelope path without its snapshot write: envelope_service.load_inputs ->
compute_envelope, then compare_to_market once per channel (each market source is a channel; its
market_ref is that source's latest fresh price as of the date). Runs in a READ ONLY transaction.

last_viable_sell = unit_cost / (1 - min_pct) = floor: the lowest price that still meets the configured
minimum margin. It depends only on costs and margins, so it is the same for every channel; the channel
decides whether the market will pay it.

Per channel: min / latest / max over that channel's fresh rows (the loader's freshness window: 30 days
unless the source's market_sources row sets another), each row converted to the envelope currency and
unit. latest is what the engine uses as the channel's market reference.
headroom_pct = (latest - floor) / floor x 100, signed. Verdict: sellable_comfortable (>= 10),
sellable_marginal (0 to < 10), not_sellable (< 0).

Sensitivity mode (--skipjack-range MIN:MAX:STEP, USD/kg): recompute the envelope with only the
"Frozen whole skipjack tuna" rate replaced, and print headroom_pct per channel for each price (channel
market references stay at their latest fresh price), then the first price at which each channel breaches.
"""
from __future__ import annotations
import argparse
import sys
from dataclasses import replace
from datetime import date
from decimal import Decimal, InvalidOperation

from _loader import DEFAULT_TENANT, LoadError, _settings_env, resolve_product

COMFORTABLE_PCT = 10
SKIPJACK = "Frozen whole skipjack tuna"


def parse_range(text: str) -> tuple[Decimal, Decimal, Decimal]:
    try:
        lo, hi, step = (Decimal(x) for x in text.split(":"))
    except (ValueError, InvalidOperation):
        raise ValueError(f"--skipjack-range must be MIN:MAX:STEP, got {text!r}") from None
    if step <= 0 or hi < lo:
        raise ValueError("--skipjack-range needs MIN <= MAX and STEP > 0")
    return lo, hi, step


def verdict(headroom_pct: float) -> str:
    if headroom_pct >= COMFORTABLE_PCT:
        return "sellable_comfortable"
    return "sellable_marginal" if headroom_pct >= 0 else "not_sellable"


def sensitivity(session, tenant: dict, product: str, as_of: date, rng: tuple[Decimal, Decimal, Decimal]) -> None:
    from costing.envelope import compare_to_market, compute_envelope
    from costing.money import Money
    from costing_api.services.envelope_service import load_inputs, load_market_prices, resolve_rates

    pid = resolve_product(session, tenant, product)
    inp = load_inputs(session, tenant["tenant_id"], pid, as_of)
    base_el = next((e for e in inp.cost_elements if e.name == SKIPJACK), None)
    if base_el is None:
        raise ValueError(f"no cost element named {SKIPJACK!r} on {product!r}")
    market = load_market_prices(session, tenant["tenant_id"], pid, as_of)
    if not market:
        print(f"no fresh market prices for {product!r} as of {as_of}")
        return
    extra = {p.price.currency for p in market} - set(inp.rates) - {inp.base_currency}
    rates = {**inp.rates, **(resolve_rates(session, extra, inp.base_currency, as_of) if extra else {})}
    env0 = compute_envelope(inp)
    channels = sorted({p.source for p in market})
    # the market side does not depend on the raw material price: each channel's latest reference, once
    refs = {c: compare_to_market(env0, [p for p in market if p.source == c], rates).market_reference_minor
            for c in channels}
    channels.sort(key=lambda c: refs[c])

    lo, hi, step = rng
    print(f"{inp.product_name}: headroom_pct = (latest - floor) / floor x 100 per channel, as of {as_of}; "
          f"rows = {SKIPJACK} rate ({base_el.rate.currency}/{base_el.unit}); "
          f"file rate {base_el.rate.major:.2f} is the reference point")
    print(" | ".join(["skipjack_usd", *channels]))
    breach: dict[str, Decimal | None] = {c: None for c in channels}
    price = lo
    while price <= hi:
        els = tuple(replace(e, rate=Money.from_major(price, e.rate.currency)) if e.name == SKIPJACK else e
                    for e in inp.cost_elements)
        floor = compute_envelope(replace(inp, cost_elements=els)).floor_minor
        cells = []
        for c in channels:
            head = (refs[c] - floor) / floor * 100
            cells.append(f"{head:+.1f}")
            if head < 0 and breach[c] is None:
                breach[c] = price
        print(" | ".join([f"{price:.2f}", *cells]))
        price += step
    print()
    for c in channels:
        x = breach[c]
        print(f"{c}: floor breach at skipjack >= {x:.2f} USD/kg" if x is not None else f"{c}: never in range")


def report(session, tenant: dict, product: str, as_of: date) -> None:
    from costing.currencies import exponent_of
    from costing.envelope import compare_to_market, compute_envelope
    from costing_api.services.envelope_service import load_inputs, load_market_prices, resolve_rates

    pid = resolve_product(session, tenant, product)
    inp = load_inputs(session, tenant["tenant_id"], pid, as_of)
    env = compute_envelope(inp)
    market = load_market_prices(session, tenant["tenant_id"], pid, as_of)     # fresh rows only
    if not market:
        print(f"no fresh market prices for {product!r} as of {as_of}")
        return
    extra = {p.price.currency for p in market} - set(inp.rates) - {inp.base_currency}
    rates = {**inp.rates, **(resolve_rates(session, extra, inp.base_currency, as_of) if extra else {})}

    exp = exponent_of(env.currency)
    fmt = lambda minor: f"{minor / 10 ** exp:.{exp}f}"    # noqa: E731
    floor = env.floor_minor
    rows = []
    for channel in sorted({p.source for p in market}):
        prices = [p for p in market if p.source == channel]
        # one row at a time through the engine = that row converted to envelope currency / unit
        each = [compare_to_market(env, [p], rates).market_reference_minor for p in prices]
        latest = compare_to_market(env, prices, rates)                         # the engine's channel view
        headroom = (latest.market_reference_minor - floor) / floor * 100
        rows.append((channel, min(each), latest.market_reference_minor, max(each), latest.position, headroom))

    print(f"{inp.product_name}: {env.currency} per {env.unit}, as of {as_of}; rows within each channel's "
          f"freshness window (30 days by default); latest = the engine's market reference")
    print("channel | min | latest | max | unit_cost | floor | target | ceiling | position_at_latest | "
          "headroom_pct | last_viable_sell | verdict")
    for channel, lo, latest, hi, pos, head in sorted(rows, key=lambda r: r[2]):
        print(" | ".join([channel, fmt(lo), fmt(latest), fmt(hi), fmt(env.unit_cost_minor), fmt(floor),
                          fmt(env.target_minor), fmt(env.ceiling_minor), pos, f"{head:+.1f}", fmt(floor),
                          verdict(head)]))

    print()
    print(f"Floor price (last viable sell): {fmt(floor)} {env.currency}/{env.unit}")
    print()
    print("Channels ranked by headroom:")
    for i, (channel, _, _, _, _, head) in enumerate(sorted(rows, key=lambda r: -r[5]), start=1):
        side = "above" if head >= 0 else "below"
        print(f"{i}. {channel} — {abs(head):.1f}% {side} floor ({verdict(head)})")
    print()
    failing = [r[0] for r in sorted(rows, key=lambda r: -r[5]) if r[5] < 0]
    print(f"Channels not clearing the floor: {', '.join(failing) if failing else 'none'}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("product", help="product name or id")
    ap.add_argument("--as-of", type=date.fromisoformat, default=date.today(), help="market date (default today)")
    ap.add_argument("--tenant", default=DEFAULT_TENANT, help="tenant id (default: the seeded example tenant)")
    ap.add_argument("--skipjack-range", metavar="MIN:MAX:STEP",
                    help="sensitivity mode: headroom per channel across skipjack prices (USD/kg)")
    args = ap.parse_args(argv)
    try:
        rng = parse_range(args.skipjack_range) if args.skipjack_range else None
    except ValueError as e:
        sys.exit(f"error: {e}")
    _settings_env()
    from sqlalchemy import text
    from costing_api.db import SessionLocal
    tenant = {"tenant_id": args.tenant, "user_id": None, "role": "viewer"}
    with SessionLocal() as s:
        with s.begin():
            s.execute(text("SET TRANSACTION READ ONLY"))
            s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": args.tenant})
            try:
                if rng:
                    sensitivity(s, tenant, args.product, args.as_of, rng)
                else:
                    report(s, tenant, args.product, args.as_of)
            except (LoadError, LookupError, ValueError) as e:
                sys.exit(f"error: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
