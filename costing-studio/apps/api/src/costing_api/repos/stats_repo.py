from __future__ import annotations
from decimal import Decimal

from sqlalchemy import text


def get_bounds(session, tenant_id, market_key, window_days: int = 365):
    row = session.execute(text("""
      SELECT p2_5, p97_5 FROM market_price_stats
       WHERE tenant_id = :t AND market_key = :m AND window_days = :w
    """), {"t": tenant_id, "m": market_key, "w": window_days}).mappings().first()
    if not row:
        return None
    return Decimal(str(row["p2_5"])), Decimal(str(row["p97_5"]))
