"""Pull market prices per product from its active market_sources. Sources without a parser are
manual (CSV / API ingest) and are skipped here; ingest_rows is shared with the CSV endpoint."""
from __future__ import annotations
from datetime import date
from decimal import Decimal, InvalidOperation

from sqlalchemy import text

from costing.currencies import KNOWN_CURRENCIES
from costing.money import Money

PARSERS: dict = {}          # parser name -> callable(source_row) -> rows; none contracted yet


def _is_fresh(last: date | None, staleness_days: int) -> bool:
    return last is not None and (date.today() - last).days < staleness_days


def run(session, tenant_id=None):
    if not tenant_id:
        return {"skipped": True, "reason": "requires tenant_id"}
    sources = session.execute(text("""
      SELECT id, product_id, source, frequency, staleness_days, url, parser
        FROM market_sources WHERE active = true AND tenant_id = :t
    """), {"t": tenant_id}).mappings().all()
    automated = [s for s in sources if s["parser"]]
    if not automated:
        return {"skipped": True, "reason": f"no automated market sources ({len(sources)} manual; use CSV ingest)"}

    errors, inserted = [], 0
    for src in automated:
        last = session.execute(text("""
          SELECT max(observed_at) FROM market_prices WHERE tenant_id = :t AND product_id = :p AND source = :s
        """), {"t": tenant_id, "p": src["product_id"], "s": src["source"]}).scalar()
        if _is_fresh(last, src["staleness_days"]):
            continue
        try:
            fetch = PARSERS.get(src["parser"])
            if fetch is None:
                raise NotImplementedError(f"unknown parser {src['parser']}")
            rows = fetch(src)
        except Exception as e:
            errors.append(f"{src['source']}: {e}")
            continue
        inserted += ingest_rows(session, tenant_id, src["product_id"], src["source"], rows)["rows"]
    if errors:
        raise RuntimeError("market refresh errors: " + "; ".join(errors[:5]))
    return {"rows": inserted}


def ingest_rows(session, tenant_id, product_id, source: str, rows) -> dict:
    """rows: [{price (major), currency, unit, observed_at (date)}]. Idempotent per
    (product, source, observed_at). Raises ValueError naming the first bad row."""
    n = 0
    for i, r in enumerate(rows):
        try:
            price = Decimal(str(r["price"]))
        except InvalidOperation:
            raise ValueError(f"row {i}: price is not a number: {r['price']!r}") from None
        if price <= 0:
            raise ValueError(f"row {i}: price must be > 0")
        if r["currency"] not in KNOWN_CURRENCIES:
            raise ValueError(f"row {i}: unknown currency {r['currency']}")
        if not str(r.get("unit") or "").strip():
            raise ValueError(f"row {i}: unit required")
        if r["observed_at"] > date.today():
            raise ValueError(f"row {i}: future date")
        res = session.execute(text("""
          INSERT INTO market_prices (tenant_id, product_id, source, price_minor, currency, unit, observed_at)
          VALUES (:t, :p, :s, :m, :c, :u, :o)
          ON CONFLICT (tenant_id, product_id, source, observed_at) DO NOTHING
        """), {"t": tenant_id, "p": str(product_id), "s": source,
               "m": Money.from_major(price, r["currency"]).amount_minor, "c": r["currency"],
               "u": r["unit"].strip(), "o": r["observed_at"]})
        n += res.rowcount
    return {"rows": n, "received": len(rows)}
