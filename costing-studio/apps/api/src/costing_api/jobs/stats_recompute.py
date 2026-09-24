from __future__ import annotations
from datetime import date, timedelta

from sqlalchemy import text

WINDOW_DAYS = 365


def run(session, tenant_id=None):
    if not tenant_id:
        return {"skipped": True, "reason": "requires tenant_id"}
    keys = session.execute(text("SELECT DISTINCT market_key FROM market_prices WHERE tenant_id = :t"),
                           {"t": tenant_id}).scalars().all()
    floor = date.today() - timedelta(days=WINDOW_DAYS)
    n = 0
    for key in keys:
        prices = session.execute(text("""
          SELECT price_major FROM market_prices
           WHERE tenant_id = :t AND market_key = :m AND observed_at >= :f ORDER BY price_major
        """), {"t": tenant_id, "m": key, "f": floor}).scalars().all()
        if len(prices) < 5:
            continue
        k = len(prices)
        session.execute(text("""
          INSERT INTO market_price_stats (tenant_id, market_key, window_days, p2_5, p50, p97_5)
          VALUES (:t, :m, :w, :a, :b, :c)
          ON CONFLICT (tenant_id, market_key, window_days)
          DO UPDATE SET p2_5 = EXCLUDED.p2_5, p50 = EXCLUDED.p50, p97_5 = EXCLUDED.p97_5, computed_at = now()
        """), {"t": tenant_id, "m": key, "w": WINDOW_DAYS, "a": prices[int(0.025 * (k - 1))],
               "b": prices[k // 2], "c": prices[int(0.975 * (k - 1))]})
        n += 1
    return {"rows": n}
