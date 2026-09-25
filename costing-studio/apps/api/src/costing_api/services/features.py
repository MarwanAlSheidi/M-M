"""Feature rows for the product-agnostic ML targets (see ml.datasets).

Series are daily, in the tenant base currency, per product unit:
- market: median across sources of the prices observed that day (converted like the envelope does)
- cost:   unit cost from the last pricing snapshot of each day
"""
from __future__ import annotations
from datetime import date, timedelta
from decimal import Decimal
from statistics import median
from typing import Optional

import pandas as pd
from sqlalchemy import text

from costing.envelope import to_base
from costing.money import Money
from costing.units import convert_mass
from ml.encoding import cyclical_month

from ..repos import hijri_repo, market_repo
from .envelope_service import resolve_rates

# lag (days) -> max staleness of the observation used for it (same contract as market_repo)
LAGS = market_repo.MAX_STALENESS_DAYS


def market_series(session, tenant_id, product, base: str, as_of: Optional[date] = None) -> dict[date, float]:
    rows = session.execute(text("""
      SELECT price_minor, currency, unit, observed_at FROM market_prices
       WHERE tenant_id = :t AND product_id = :p AND (CAST(:d AS date) IS NULL OR observed_at <= :d2)
    """), {"t": tenant_id, "p": product.id, "d": as_of, "d2": as_of}).mappings().all()
    if not rows:
        return {}
    rates = resolve_rates(session, {r["currency"] for r in rows}, base, as_of or date.today())
    by_day: dict[date, list[Decimal]] = {}
    for r in rows:
        m = to_base(Money(int(r["price_minor"]), r["currency"]), base, rates).major
        if r["unit"] != product.base_unit:
            try:
                m = m * convert_mass(Decimal(1), product.base_unit, r["unit"])
            except ValueError:
                continue                     # not comparable to this product's unit
        by_day.setdefault(r["observed_at"], []).append(m)
    return {d: float(median(v)) for d, v in by_day.items()}


def cost_series(session, tenant_id, product_id) -> dict[date, float]:
    rows = session.execute(text("""
      SELECT DISTINCT ON (computed_at::date) computed_at::date AS d, unit_cost_minor, currency
        FROM pricing_snapshots WHERE tenant_id = :t AND product_id = :p
       ORDER BY computed_at::date, computed_at DESC
    """), {"t": tenant_id, "p": str(product_id)}).mappings().all()
    return {r["d"]: float(Money(int(r["unit_cost_minor"]), r["currency"]).major) for r in rows}


def lags(series: dict[date, float], as_of: date) -> Optional[dict[str, float]]:
    """Latest value at or before as_of - n, no older than the staleness window. None if any is missing."""
    out = {}
    for n, stale in LAGS.items():
        target = as_of - timedelta(days=n)
        cands = [d for d in series if target - timedelta(days=stale) <= d <= target]
        if not cands:
            return None
        out[f"lag{n}"] = series[max(cands)]
    return out


def calendar(session, d: date) -> dict:
    s, c = cyclical_month(d.month)
    return {"month_sin": s, "month_cos": c, "is_ramadan": int(hijri_repo.is_ramadan(session, d))}


def market_features(session, tenant_id, product, base: str, as_of: date) -> tuple[Optional[pd.DataFrame], Optional[str]]:
    """One feature row for MARKET_PRICE at as_of, or (None, skip_reason)."""
    lg = lags(market_series(session, tenant_id, product, base, as_of), as_of)
    if lg is None:
        return None, "market price lags unavailable or stale"
    row = {"category": product.category, "price_lag1": lg["lag1"], "price_lag7": lg["lag7"],
           "price_lag30": lg["lag30"], **calendar(session, as_of)}
    return pd.DataFrame([row]), None
