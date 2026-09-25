from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date
from typing import List

import pandas as pd

from .encoding import cyclical_month_series


@dataclass
class FeatureSpec:
    """Column lists come from each TargetSpec (see datasets.py); no domain defaults."""
    numeric: List[str] = field(default_factory=list)
    categorical: List[str] = field(default_factory=list)
    target_col: str = "target"

    @property
    def all_cols(self) -> List[str]:
        return self.numeric + self.categorical


def build_frame(df) -> pd.DataFrame:
    """Accepts either a list[dict] or a DataFrame."""
    df = pd.DataFrame(df) if not isinstance(df, pd.DataFrame) else df.copy()
    if "deal_month" in df:
        sin_s, cos_s = cyclical_month_series(df["deal_month"])
        df["month_sin"] = sin_s
        df["month_cos"] = cos_s
    return df


def make_time_split(df: pd.DataFrame, train_end: date, test_end: date,
                    date_col: str = "deal_date") -> tuple[pd.DataFrame, pd.DataFrame]:
    df = df.sort_values(date_col)
    train = df[df[date_col] < train_end]
    test = df[(df[date_col] >= train_end) & (df[date_col] < test_end)]
    return train, test
