"""Nightly retrain of the product-agnostic targets. Each target is gated on its own history;
promotion must beat the champion and the ridge baseline on the same walk-forward folds.

- forecast_market_price_per_product: daily market reference per product (ceiling moves)
- forecast_input_cost_drift:        daily unit cost from pricing snapshots (floor moves)
- estimate_elasticity:              needs transaction data; skipped until the schema holds it
"""
from __future__ import annotations
import json
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
from sqlalchemy import text

from ml.datasets import ELASTICITY, INPUT_COST_DRIFT, MARKET_PRICE

from ..repos import product_repo, tenant_repo
from ..services.features import calendar, cost_series, lags, market_series
from ..settings import settings

MIN_HISTORY_DAYS = 180
MIN_ROWS = 60
FWD_TOLERANCE_DAYS = 7      # forward value = first observation within this window after d + horizon


def run(session, tenant_id=None):
    if not tenant_id:
        return {"skipped": True, "reason": "requires tenant_id"}
    base = tenant_repo.base_currency(session, tenant_id)
    products = [product_repo.get_product(session, tenant_id, pid)
                for pid in product_repo.list_product_ids(session, tenant_id)]

    results = {
        MARKET_PRICE.name: _train_target(
            session, tenant_id, MARKET_PRICE, "price", base,
            [(p, market_series(session, tenant_id, p, base)) for p in products]),
        INPUT_COST_DRIFT.name: _train_target(
            session, tenant_id, INPUT_COST_DRIFT, "cost", base,
            [(p, cost_series(session, tenant_id, p.id)) for p in products]),
        ELASTICITY.name: {"skipped": True, "reason": "no transaction data"},
    }
    promoted = {k: v for k, v in results.items() if not v.get("skipped")}
    reason = "; ".join(f"{k}: {v['reason']}" for k, v in results.items())
    if not promoted:
        return {"skipped": True, "reason": reason}
    return {"rows": sum(v.get("rows", 0) for v in promoted.values()), "reason": reason}


def _rows_for(session, series: dict[date, float], product, prefix: str, horizon: int) -> list[dict]:
    days = sorted(series)
    out = []
    for d in days:
        lg = lags(series, d)
        fwd = next((series[x] for x in days if d + timedelta(days=horizon) <= x
                    <= d + timedelta(days=horizon + FWD_TOLERANCE_DAYS)), None)
        if lg is None or fwd is None:
            continue
        out.append({"deal_date": d, "deal_month": d.month, "category": product.category,
                    f"{prefix}_lag1": lg["lag1"], f"{prefix}_lag7": lg["lag7"], f"{prefix}_lag30": lg["lag30"],
                    f"{prefix}_fwd": fwd, **calendar(session, d)})
    return out


def _train_target(session, tenant_id, spec, prefix: str, base: str, series_by_product: list) -> dict:
    history = max((len(s) for _, s in series_by_product), default=0)
    if history < MIN_HISTORY_DAYS:
        return {"skipped": True, "reason": f"history {history} days < {MIN_HISTORY_DAYS}"}
    rows = [r for p, s in series_by_product for r in _rows_for(session, s, p, prefix, spec.horizon_days)]
    if len(rows) < MIN_ROWS:
        return {"skipped": True, "reason": f"only {len(rows)} usable rows (< {MIN_ROWS})"}

    from ml.backtest import summarize, summarize_ridge, walk_forward
    from ml.models import train
    from ml.promote import should_promote

    df = pd.DataFrame(rows)
    folds = walk_forward(df, spec, name=spec.name, initial_train_days=MIN_HISTORY_DAYS,
                         test_window_days=60, step_days=30)
    challenger = summarize(folds)
    decision = should_promote(champion_metrics=_champion_metrics(session, tenant_id, spec.name) or {},
                              challenger_metrics=challenger, baseline_metrics=summarize_ridge(folds))
    if not decision.promoted:
        return {"skipped": True, "reason": decision.reason}

    model = train(df, spec.feature_spec, spec.target_col, name=spec.name,
                  version=f"v{date.today():%Y%m%d}-{len(rows)}")
    artifact_path = model.save(Path(settings.model_store_root) / tenant_id)   # returns full path
    session.execute(text("UPDATE model_registry SET is_champion = false WHERE tenant_id = :t AND target = :tg"),
                    {"t": tenant_id, "tg": spec.name})
    session.execute(text("""
      INSERT INTO model_registry (tenant_id, target, version, artifact_path, target_currency, target_unit,
                                  library_versions, metrics, is_champion, promoted_at)
      VALUES (:t, :tg, :v, :p, :c, 'product_unit', CAST(:lv AS jsonb), CAST(:m AS jsonb), true, now())
    """), {"t": tenant_id, "tg": spec.name, "v": model.version, "p": str(artifact_path), "c": base,
           "lv": json.dumps(model.library_versions), "m": json.dumps(challenger)})
    return {"rows": len(rows), "reason": f"promoted {model.version}"}


def _champion_metrics(session, tenant_id, target: str):
    row = session.execute(text("""
      SELECT metrics FROM model_registry WHERE tenant_id = :t AND target = :tg AND is_champion
       ORDER BY promoted_at DESC LIMIT 1
    """), {"t": tenant_id, "tg": target}).first()
    return dict(row.metrics) if row else None
