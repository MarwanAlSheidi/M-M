"""walk_forward mechanics with a stub model (no LightGBM needed)."""
from datetime import date, timedelta
import pandas as pd

from ml.backtest import summarize, summarize_ridge, walk_forward
from ml.datasets import MARKET_PRICE


class _Stub:
    def predict(self, df):
        y = df["price_lag1"].astype(float).values
        return pd.DataFrame({"p10": y * 0.95, "p50": y, "p90": y * 1.05, "ridge": y * 1.01}, index=df.index)


def _factory(train_df, spec, target_col, name, version):
    _factory.train_max.append(train_df["deal_date"].max())
    return _Stub()


def _rows(n=400):
    base = date(2023, 1, 1)
    out = []
    for i in range(n):
        d = base + timedelta(days=i)
        p = 3.0 + i * 0.001
        out.append({"deal_date": d, "deal_month": d.month, "category": "building_materials",
                    "price_lag1": p, "price_lag7": p, "price_lag30": p, "is_ramadan": 0, "price_fwd": p})
    return out


def test_embargo_and_metrics():
    _factory.train_max = []
    folds = walk_forward(pd.DataFrame(_rows()), MARKET_PRICE, "fp", initial_train_days=180,
                         test_window_days=60, step_days=30, model_factory=_factory)
    assert folds
    for f, tmax in zip(folds, _factory.train_max):
        assert tmax < f.test_start - timedelta(days=MARKET_PRICE.horizon_days - 1)
    s = summarize(folds)
    assert s["mape_mean"] == 0.0 and s["coverage_mean"] == 1.0
    assert abs(summarize_ridge(folds)["mape_mean"] - 0.01) < 1e-9
