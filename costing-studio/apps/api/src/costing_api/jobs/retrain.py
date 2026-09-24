"""Nightly retrain of the forward-price model. Gated on market history; promotion must
beat the champion and the ridge baseline computed on the same walk-forward folds."""
from __future__ import annotations
import json
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
from sqlalchemy import text

from ..repos import product_repo
from ..services.features import build_features
from ..settings import settings

MIN_MARKET_OBS = 180
MIN_ROWS = 60
TARGET = "forward_purchase_price_per_kg"


def run(session, tenant_id=None):
    if not tenant_id:
        return {"skipped": True, "reason": "requires tenant_id"}
    obs = session.execute(text("SELECT count(DISTINCT observed_at) FROM market_prices WHERE tenant_id = :t"),
                          {"t": tenant_id}).scalar() or 0
    if obs < MIN_MARKET_OBS:
        return {"skipped": True, "reason": f"market history {obs} days < {MIN_MARKET_OBS}"}

    rows = _build_training_rows(session, tenant_id)
    if len(rows) < MIN_ROWS:
        return {"skipped": True, "reason": f"only {len(rows)} usable rows (< {MIN_ROWS})"}

    from ml.backtest import summarize, summarize_ridge, walk_forward
    from ml.datasets import FORWARD_PRICE
    from ml.models import train
    from ml.promote import should_promote

    df = pd.DataFrame(rows)
    folds = walk_forward(df, FORWARD_PRICE, name=TARGET, initial_train_days=180,
                         test_window_days=60, step_days=30)
    challenger = summarize(folds)
    decision = should_promote(champion_metrics=_champion_metrics(session, tenant_id) or {},
                              challenger_metrics=challenger, baseline_metrics=summarize_ridge(folds))
    if not decision.promoted:
        return {"skipped": True, "reason": decision.reason}

    model = train(df, FORWARD_PRICE.feature_spec, FORWARD_PRICE.target_col, name=TARGET,
                  version=f"v{date.today():%Y%m%d}-{len(rows)}")
    artifact_path = model.save(Path(settings.model_store_root) / tenant_id)   # returns full path

    session.execute(text("""
      UPDATE model_registry SET is_champion = false WHERE tenant_id = :t AND target = :tg
    """), {"t": tenant_id, "tg": TARGET})
    session.execute(text("""
      INSERT INTO model_registry (tenant_id, target, version, artifact_path, target_currency, target_unit,
                                  library_versions, metrics, is_champion, promoted_at)
      VALUES (:t, :tg, :v, :p, 'USD', 'kg', CAST(:lv AS jsonb), CAST(:m AS jsonb), true, now())
    """), {"t": tenant_id, "tg": TARGET, "v": model.version, "p": str(artifact_path),
           "lv": json.dumps(model.library_versions), "m": json.dumps(challenger)})
    return {"rows": len(rows), "reason": f"promoted {model.version}"}


def _build_training_rows(session, tenant_id):
    deals = session.execute(text("""
      SELECT d.deal_date, d.currency, p.sku
        FROM deals d JOIN products p ON p.id = d.product_id
       WHERE d.tenant_id = :t AND d.status = 'confirmed' ORDER BY d.deal_date
    """), {"t": tenant_id}).mappings().all()
    out = []
    for d in deals:
        product = product_repo.get_product(session, tenant_id, d["sku"])
        feats, skip = build_features(session, tenant_id, product, d["deal_date"], d["currency"])
        if skip:
            continue
        fwd = session.execute(text("""
          SELECT price_major FROM market_prices
           WHERE tenant_id = :t AND market_key = :m AND observed_at >= :target
           ORDER BY observed_at ASC LIMIT 1
        """), {"t": tenant_id, "m": product.market_key,
               "target": d["deal_date"] + timedelta(days=30)}).scalar()
        if fwd is None:
            continue
        row = feats.iloc[0].to_dict()
        row.update(forward_price_kg=float(fwd), deal_date=d["deal_date"], deal_month=d["deal_date"].month)
        out.append(row)
    return out


def _champion_metrics(session, tenant_id):
    row = session.execute(text("""
      SELECT metrics FROM model_registry WHERE tenant_id = :t AND target = :tg AND is_champion
       ORDER BY promoted_at DESC LIMIT 1
    """), {"t": tenant_id, "tg": TARGET}).first()
    return dict(row.metrics) if row else None
