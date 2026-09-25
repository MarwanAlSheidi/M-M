from __future__ import annotations
from dataclasses import dataclass
from typing import List

import pandas as pd

from .features import FeatureSpec, build_frame


@dataclass
class TargetSpec:
    name: str
    feature_spec: FeatureSpec
    target_col: str
    horizon_days: int = 0


# Product-agnostic targets. Rows are (product, date); `deal_date` is the harness's date column.
# Prices/costs are floats in major units of the tenant base currency, per product unit.

# Ceiling moves: where the market price for a product will be `horizon_days` ahead.
MARKET_PRICE = TargetSpec(
    name="forecast_market_price_per_product",
    feature_spec=FeatureSpec(
        numeric=["price_lag1", "price_lag7", "price_lag30", "month_sin", "month_cos", "is_ramadan"],
        categorical=["category"],
        target_col="price_fwd",
    ),
    target_col="price_fwd",
    horizon_days=30,
)

# Floor moves: where the product's unit cost (sum of cost elements) will be `horizon_days` ahead.
INPUT_COST_DRIFT = TargetSpec(
    name="forecast_input_cost_drift",
    feature_spec=FeatureSpec(
        numeric=["cost_lag1", "cost_lag7", "cost_lag30", "month_sin", "month_cos"],
        categorical=["category"],
        target_col="cost_fwd",
    ),
    target_col="cost_fwd",
    horizon_days=30,
)

# Demand response to price. Needs transaction data (units sold at a price), which the schema
# does not hold yet; retrain skips it until such data exists.
ELASTICITY = TargetSpec(
    name="estimate_elasticity",
    feature_spec=FeatureSpec(
        numeric=["price", "price_to_market_ratio", "month_sin", "month_cos", "is_ramadan"],
        categorical=["category"],
        target_col="units_sold",
    ),
    target_col="units_sold",
)

ALL_TARGETS = [MARKET_PRICE, INPUT_COST_DRIFT, ELASTICITY]


def build_dataset(deals, spec: TargetSpec) -> pd.DataFrame:
    df = build_frame(deals)
    cols = spec.feature_spec.all_cols + [spec.target_col, "deal_date"]
    cols = [c for c in cols if c in df.columns]
    return df[cols].dropna()
