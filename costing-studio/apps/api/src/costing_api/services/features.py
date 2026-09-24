from __future__ import annotations
from datetime import date
from decimal import Decimal
from typing import Optional

import pandas as pd

from costing.currencies import is_pegged_to_usd, usd_peg_rate
from ml.encoding import cyclical_month

from ..repos import hijri_repo, market_repo


def build_features(session, tenant_id, product_row, deal_date: date,
                   currency: str) -> tuple[Optional[pd.DataFrame], Optional[str]]:
    """Returns (features, skip_reason). Caller must not run ML when skip_reason is set."""
    spot = market_repo.latest_prices(session, tenant_id, product_row.market_key, deal_date)
    if spot is None:
        return None, "market price lags unavailable or stale"

    lags = market_repo.fx_lags(session, currency, deal_date)
    if lags is None:
        if currency == "USD":
            peg = Decimal("1")
        elif is_pegged_to_usd(currency):
            peg = Decimal("1") / usd_peg_rate(currency)   # 1 ccy in USD
        else:
            return None, f"no fx_rates for {currency}"
        lags = {"lag1": peg, "lag7": peg, "lag30": peg}

    month_sin, month_cos = cyclical_month(deal_date.month)
    attrs = product_row.attributes
    row = {
        "species": attrs.get("species"), "form": attrs.get("form"), "grade": attrs.get("grade"),
        "origin_country": attrs.get("origin_country"),
        "spot_price_lag1": float(spot["lag1"]), "spot_price_lag7": float(spot["lag7"]),
        "spot_price_lag30": float(spot["lag30"]),
        "fx_lag1": float(lags["lag1"]), "fx_lag7": float(lags["lag7"]), "fx_lag30": float(lags["lag30"]),
        "month_sin": month_sin, "month_cos": month_cos,
        "is_ramadan": int(hijri_repo.is_ramadan(session, deal_date)),
    }
    return pd.DataFrame([row]), None
