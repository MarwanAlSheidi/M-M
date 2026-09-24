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


FORWARD_PRICE = TargetSpec(
    name="forward_purchase_price_per_kg",
    feature_spec=FeatureSpec(
        numeric=["spot_price_lag1", "spot_price_lag7", "spot_price_lag30",
                 "fx_lag1", "fx_lag7", "fx_lag30", "month_sin", "month_cos", "is_ramadan"],
        categorical=["species", "form", "grade", "origin_country"],
        target_col="forward_price_kg",
    ),
    target_col="forward_price_kg",
    horizon_days=30,
)

FORWARD_FREIGHT = TargetSpec(
    name="forward_freight_rate_per_lane",
    feature_spec=FeatureSpec(
        numeric=["fuel_index_lag1", "container_util_lag1", "month_sin", "month_cos"],
        categorical=["origin_country", "dest_country", "mode", "container_type"],
        target_col="freight_rate_per_kg",
    ),
    target_col="freight_rate_per_kg",
    horizon_days=14,
)

REALIZED_YIELD = TargetSpec(
    name="realized_yield_pct",
    feature_spec=FeatureSpec(
        numeric=["qty", "storage_days", "temp_c"],
        categorical=["species", "form_in", "form_out", "process_type", "supplier_id"],
        target_col="realized_yield",
    ),
    target_col="realized_yield",
)

PRE_QUOTE_LANDED = TargetSpec(
    name="pre_quote_landed_estimate",
    feature_spec=FeatureSpec(
        numeric=["qty", "spot_price_lag1", "fx_lag1", "duty_rate", "vat_rate", "wacc",
                 "days_to_customer_payment", "supplier_terms_days", "month_sin", "month_cos"],
        categorical=["species", "form", "grade", "origin_country", "dest_country",
                     "incoterm", "mode", "hs_code"],
        target_col="landed_cost_per_input_unit",
    ),
    target_col="landed_cost_per_input_unit",
)

ALL_TARGETS = [FORWARD_PRICE, FORWARD_FREIGHT, REALIZED_YIELD, PRE_QUOTE_LANDED]


def build_dataset(deals, spec: TargetSpec) -> pd.DataFrame:
    df = build_frame(deals)
    cols = spec.feature_spec.all_cols + [spec.target_col, "deal_date"]
    cols = [c for c in cols if c in df.columns]
    return df[cols].dropna()
