from __future__ import annotations
from datetime import date
from decimal import Decimal

from sqlalchemy import text

from costing.currencies import KNOWN_CURRENCIES

KNOWN_UNITS = {"kg", "tonne", "lb", "case"}


def _is_fresh(last: date | None, staleness_days: int) -> bool:
    return last is not None and (date.today() - last).days < staleness_days


def run(session, tenant_id=None):
    if not tenant_id:
        return {"skipped": True, "reason": "requires tenant_id"}
    sources = session.execute(text("""
      SELECT id, market_key, source, frequency, staleness_days, url, parser
        FROM market_sources WHERE active = true AND tenant_id = :t
    """), {"t": tenant_id}).mappings().all()
    if not sources:
        return {"skipped": True, "reason": "no active market sources (use CSV ingest)"}

    errors, inserted = [], 0
    for src in sources:
        last = session.execute(text("""
          SELECT max(observed_at) FROM market_prices
           WHERE tenant_id = :t AND market_key = :m AND source = :s
        """), {"t": tenant_id, "m": src["market_key"], "s": src["source"]}).scalar()
        if _is_fresh(last, src["staleness_days"]):
            continue
        try:
            rows = _fetch_source(src)
        except Exception as e:
            errors.append(f"{src['market_key']}:{src['source']}: {e}")
            continue
        for r in rows:
            res = session.execute(text("""
              INSERT INTO market_prices (tenant_id, market_key, source, price_major, currency, unit, observed_at)
              VALUES (:t, :m, :s, :p, :c, :u, :o)
              ON CONFLICT (tenant_id, market_key, source, observed_at) DO NOTHING
            """), {"t": tenant_id, "m": src["market_key"], "s": src["source"], "p": r["price"],
                   "c": r["currency"], "u": r["unit"], "o": r["observed_at"]})
            inserted += res.rowcount
    if errors:
        raise RuntimeError("ingest errors: " + "; ".join(errors[:5]))
    return {"rows": inserted}


def _fetch_source(src):
    if src["parser"] == "bangkok_skipjack":
        raise NotImplementedError("parser stub; no feed contract yet - use CSV ingest")
    raise NotImplementedError(f"unknown parser {src['parser']}")


def ingest_csv(session, tenant_id, market_key, rows, source="manual"):
    n = 0
    for i, r in enumerate(rows):
        price = Decimal(str(r["price_major"]))
        if price <= 0:
            raise ValueError(f"row {i}: price must be > 0")
        if r["currency"] not in KNOWN_CURRENCIES:
            raise ValueError(f"row {i}: unknown currency {r['currency']}")
        if r["unit"] not in KNOWN_UNITS:
            raise ValueError(f"row {i}: unknown unit {r['unit']}")
        if r["observed_at"] > date.today():
            raise ValueError(f"row {i}: future date")
        res = session.execute(text("""
          INSERT INTO market_prices (tenant_id, market_key, source, price_major, currency, unit, observed_at)
          VALUES (:t, :m, :s, :p, :c, :u, :o)
          ON CONFLICT (tenant_id, market_key, source, observed_at) DO NOTHING
        """), {"t": tenant_id, "m": market_key, "s": source, "p": price, "c": r["currency"],
               "u": r["unit"], "o": r["observed_at"]})
        n += res.rowcount
    return {"rows": n}
