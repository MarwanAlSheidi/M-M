"""Requires LightGBM — first real exercise of models.py and backtest.py."""
from datetime import date, timedelta
import numpy as np
import pandas as pd

from ml.backtest import summarize, walk_forward
from ml.datasets import FORWARD_PRICE


def _synthetic_deals(n=400):
    base = date(2023, 1, 1)
    rows = []
    for i in range(n):
        d = base + timedelta(days=i)
        rows.append({
            "deal_date": d, "deal_month": d.month,
            "species": "YF", "form": "WR", "grade": "A", "origin_country": "TH",
            "spot_price_lag1": 3.0 + i * 0.001, "spot_price_lag7": 3.0 + i * 0.001,
            "spot_price_lag30": 3.0 + i * 0.001,
            "fx_lag1": 0.38, "fx_lag7": 0.38, "fx_lag30": 0.38, "is_ramadan": 0,
            "forward_price_kg": 3.0 + i * 0.001,
        })
    return rows


def test_walk_forward_runs():
    df = pd.DataFrame(_synthetic_deals())
    folds = walk_forward(df, FORWARD_PRICE, name="forward_price",
                         initial_train_days=180, test_window_days=60, step_days=30)
    assert len(folds) > 0
    s = summarize(folds)
    assert s["n_folds"] == len(folds)
    if not np.isnan(s["mape_mean"]):
        assert s["mape_mean"] < 1.0
