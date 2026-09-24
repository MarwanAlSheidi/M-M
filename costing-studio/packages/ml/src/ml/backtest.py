"""Walk-forward backtest with an embargo equal to the target horizon."""
from __future__ import annotations
from dataclasses import dataclass
from datetime import timedelta
from typing import Callable, Dict, List, Optional

import numpy as np
import pandas as pd

from .datasets import TargetSpec, build_dataset


@dataclass
class FoldResult:
    train_end: object
    test_start: object
    test_end: object
    n_test: int
    mape: float
    mae: float
    coverage_p10_p90: float
    ridge_mape: float = float("nan")


def _mape(y, yhat) -> float:
    mask = y != 0
    if not mask.any():
        return float("nan")
    return float(np.mean(np.abs((y[mask] - yhat[mask]) / y[mask])))


def walk_forward(df: pd.DataFrame, spec: TargetSpec, name: str,
                 initial_train_days: int = 540, test_window_days: int = 90,
                 step_days: int = 30, model_factory: Optional[Callable] = None) -> List[FoldResult]:
    """Train on [0, t - horizon), test on [t, t + window)."""
    if model_factory is None:
        from .models import train as model_factory
    df = build_dataset(df, spec).sort_values("deal_date").reset_index(drop=True)
    if df.empty:
        return []
    start, end = df["deal_date"].min(), df["deal_date"].max()
    horizon = timedelta(days=spec.horizon_days)

    folds: List[FoldResult] = []
    t = start + timedelta(days=initial_train_days)
    idx = 0
    while t + timedelta(days=test_window_days) <= end:
        train_df = df[df["deal_date"] < (t - horizon)]
        test_df = df[(df["deal_date"] >= t) & (df["deal_date"] < t + timedelta(days=test_window_days))]
        if len(train_df) < 30 or len(test_df) < 3:
            t += timedelta(days=step_days)
            continue
        m = model_factory(train_df, spec.feature_spec, spec.target_col, name=name, version=f"fold{idx}")
        preds = m.predict(test_df)
        y = test_df[spec.target_col].astype(float).values
        yhat = preds["p50"].values
        folds.append(FoldResult(
            train_end=t - horizon, test_start=t, test_end=t + timedelta(days=test_window_days),
            n_test=len(test_df), mape=_mape(y, yhat), mae=float(np.mean(np.abs(y - yhat))),
            coverage_p10_p90=float(np.mean((preds["p10"].values <= y) & (y <= preds["p90"].values))),
            ridge_mape=_mape(y, preds["ridge"].values) if "ridge" in preds else float("nan"),
        ))
        t += timedelta(days=step_days)
        idx += 1
    return folds


def summarize(folds: List[FoldResult]) -> Dict[str, float]:
    if not folds:
        return {"n_folds": 0}
    mapes = [f.mape for f in folds if not np.isnan(f.mape)]
    return {
        "n_folds": len(folds),
        "mape_mean": float(np.mean(mapes)) if mapes else float("nan"),
        "mape_std": float(np.std(mapes)) if mapes else float("nan"),
        "mae_mean": float(np.mean([f.mae for f in folds])),
        "coverage_mean": float(np.mean([f.coverage_p10_p90 for f in folds])),
    }


def summarize_ridge(folds: List[FoldResult]) -> Dict[str, float]:
    if not folds:
        return {"n_folds": 0}
    vals = [f.ridge_mape for f in folds if not np.isnan(f.ridge_mape)]
    return {"n_folds": len(folds), "mape_mean": float(np.mean(vals)) if vals else float("nan")}
