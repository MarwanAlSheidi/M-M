"""Last viable sell price per market channel for one product. Read-only.

    DATABASE_URL=postgresql+psycopg://costing_app:app_pw@localhost:5432/costing \\
      uv run python scripts/last_sell_price.py "Canned Light Tuna in Sunflower Oil" [--as-of 2026-09-25]

Uses the loader's envelope path without its snapshot write: envelope_service.load_inputs ->
compute_envelope, then compare_to_market once per channel (each market source is a channel; its
market_ref is that source's latest fresh price as of the date). Runs in a READ ONLY transaction.

last_viable_sell = unit_cost / (1 - min_pct) = floor: the lowest price that still meets the configured
minimum margin. It depends only on costs and margins, so it is the same for every channel; the channel
decides whether the market will pay it. A channel is sellable when its market_ref >= floor
(position attractive or too_high).
"""
from __future__ import annotations
import argparse
import sys
from datetime import date

from _loader import DEFAULT_TENANT, LoadError, _settings_env, resolve_product

SELLABLE = ("attractive", "too_high")


def report(session, tenant: dict, product: str, as_of: date) -> None:
    from costing.currencies import exponent_of
    from costing.envelope import compare_to_market, compute_envelope
    from costing_api.services.envelope_service import load_inputs, load_market_prices, resolve_rates

    pid = resolve_product(session, tenant, product)
    inp = load_inputs(session, tenant["tenant_id"], pid, as_of)
    env = compute_envelope(inp)
    market = load_market_prices(session, tenant["tenant_id"], pid, as_of)
    if not market:
        print(f"no fresh market prices for {product!r} as of {as_of}")
        return
    extra = {p.price.currency for p in market} - set(inp.rates) - {inp.base_currency}
    rates = {**inp.rates, **(resolve_rates(session, extra, inp.base_currency, as_of) if extra else {})}

    exp = exponent_of(env.currency)
    fmt = lambda minor: f"{minor / 10 ** exp:.{exp}f}"    # noqa: E731
    rows = []
    for channel in sorted({p.source for p in market}):
        cmp = compare_to_market(env, [p for p in market if p.source == channel], rates)
        rows.append((channel, cmp.market_reference_minor, cmp.position))
    rows.sort(key=lambda r: r[1])

    print(f"{inp.product_name}: {env.currency} per {env.unit}, as of {as_of}; "
          f"market_ref = latest fresh price per channel")
    print("channel | market_ref | unit_cost | floor | target | ceiling | position | last_viable_sell")
    for channel, ref, pos in rows:
        print(" | ".join([channel, fmt(ref), fmt(env.unit_cost_minor), fmt(env.floor_minor), fmt(env.target_minor),
                          fmt(env.ceiling_minor), pos, fmt(env.floor_minor)]))
    sellable = [r for r in rows if r[2] in SELLABLE]
    if sellable:
        channel, _, pos = sellable[0]
        print(f"Lowest channel where product is sellable: {channel} at {fmt(env.floor_minor)} (position: {pos})")
    else:
        print("Not sellable at any channel: cost exceeds market in all channels.")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("product", help="product name or id")
    ap.add_argument("--as-of", type=date.fromisoformat, default=date.today(), help="market date (default today)")
    ap.add_argument("--tenant", default=DEFAULT_TENANT, help="tenant id (default: the seeded example tenant)")
    args = ap.parse_args(argv)
    _settings_env()
    from sqlalchemy import text
    from costing_api.db import SessionLocal
    tenant = {"tenant_id": args.tenant, "user_id": None, "role": "viewer"}
    with SessionLocal() as s:
        with s.begin():
            s.execute(text("SET TRANSACTION READ ONLY"))
            s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": args.tenant})
            try:
                report(s, tenant, args.product, args.as_of)
            except (LoadError, LookupError, ValueError) as e:
                sys.exit(f"error: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
