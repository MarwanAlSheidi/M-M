from __future__ import annotations
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import text

# lag (days) -> max staleness of the observation used for it
MAX_STALENESS_DAYS = {1: 5, 7: 5, 30: 10}


def fx_lags(session, currency: str, as_of: date) -> dict | None:
    """fx_rates is global. Direction: 1 base = rate × quote (here base=currency, quote=USD)."""
    lags = {}
    for n, stale in MAX_STALENESS_DAYS.items():
        target = as_of - timedelta(days=n)
        v = session.execute(text("""
          SELECT rate FROM fx_rates
           WHERE base = :c AND quote = 'USD'
             AND observed_at <= :d AND observed_at >= :floor
           ORDER BY observed_at DESC LIMIT 1
        """), {"c": currency, "d": target, "floor": target - timedelta(days=stale)}).scalar()
        lags[f"lag{n}"] = Decimal(str(v)) if v is not None else None
    if any(v is None for v in lags.values()):
        return None
    return lags


def latest_fx_rate(session, base: str, quote: str, as_of: date | None = None) -> Decimal | None:
    """1 base = rate × quote. None if not on file (pegs are handled by FxResolver)."""
    if base == quote:
        return Decimal("1")
    v = session.execute(text("""
      SELECT rate FROM fx_rates
       WHERE base = :b AND quote = :q AND (CAST(:d AS date) IS NULL OR observed_at <= :d)
       ORDER BY observed_at DESC LIMIT 1
    """), {"b": base, "q": quote, "d": as_of}).scalar()
    return Decimal(str(v)) if v is not None else None
