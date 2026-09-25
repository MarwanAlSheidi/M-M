"""Load market prices from a CSV for one product + source (same path as the API ingest), then print
the envelope with its market position.

    DATABASE_URL=postgresql+psycopg://costing_app:app_pw@localhost:5432/costing \\
      uv run python scripts/load_market_prices.py "Portland cement 50kg bag" retail-survey prices.csv

CSV columns: observed_at (YYYY-MM-DD), price_major, currency, unit (the product's base unit, or a
mass unit such as kg / tonne for mass-based products). Re-loading the same (source, date) is a no-op.
Prices older than the source's staleness window (market_sources, default 30 days) are stored but do
not count toward the market reference.
"""
from __future__ import annotations
import argparse
import csv
import sys
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

from _loader import DEFAULT_TENANT, LoadError, check_exact, print_envelope, resolve_product, run_in_tenant

COLUMNS = {"observed_at", "price_major", "currency", "unit"}


def read_rows(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        missing = COLUMNS - {c.strip() for c in reader.fieldnames or []}
        if missing:
            raise LoadError(f"CSV missing columns: {sorted(missing)}")
        rows = []
        for i, r in enumerate(reader, start=2):              # line numbers as a spreadsheet shows them
            r = {k.strip(): (v or "").strip() for k, v in r.items() if k}
            try:
                price, ccy = Decimal(r["price_major"]), r["currency"].upper()
                observed = date.fromisoformat(r["observed_at"])
            except (InvalidOperation, ValueError) as e:
                raise LoadError(f"line {i}: {e}") from None
            check_exact(price, ccy, f"line {i} price")
            rows.append({"price": price, "currency": ccy, "unit": r["unit"], "observed_at": observed})
    if not rows:
        raise LoadError("CSV has no rows")
    return rows


def load(session, tenant: dict, product: str, source: str, rows: list[dict]) -> tuple[str, dict]:
    from costing_api.jobs.market_refresh import ingest_rows
    pid = resolve_product(session, tenant, product)
    try:
        return pid, ingest_rows(session, tenant["tenant_id"], pid, source, rows)
    except ValueError as e:
        raise LoadError(str(e)) from None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("product", help="product name or id")
    ap.add_argument("source", help="market source name, e.g. retail-survey")
    ap.add_argument("file", type=Path)
    ap.add_argument("--tenant", default=DEFAULT_TENANT, help="tenant id (default: the seeded example tenant)")
    args = ap.parse_args(argv)
    try:
        rows = read_rows(args.file)
    except OSError as e:
        sys.exit(f"error: cannot read {args.file}: {e}")
    except LoadError as e:
        sys.exit(f"error: {e}")
    pid, res = run_in_tenant(args.tenant, lambda s, t: load(s, t, args.product, args.source, rows))
    print(f"inserted {res['rows']} of {res['received']} rows (duplicates of existing (source, date) are skipped)")
    run_in_tenant(args.tenant, lambda s, t: print_envelope(s, t, pid, "load_market_prices"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
