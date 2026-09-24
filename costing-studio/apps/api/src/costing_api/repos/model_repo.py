from __future__ import annotations
import logging
from pathlib import Path

from sqlalchemy import text

log = logging.getLogger(__name__)


def get_champion(session, tenant_id, target: str):
    row = session.execute(text("""
      SELECT version, artifact_path, target_currency, target_unit
        FROM model_registry
       WHERE tenant_id = :t AND target = :tg AND is_champion
       ORDER BY promoted_at DESC LIMIT 1
    """), {"t": tenant_id, "tg": target}).first()
    if not row:
        return None
    try:
        from ml.models import TrainedModel
        model = TrainedModel.load(Path(row.artifact_path))
    except Exception as e:  # version mismatch or missing artifact -> fail closed
        log.error("Champion load failed tenant=%s target=%s version=%s: %s",
                  tenant_id, target, row.version, e)
        return None
    model.target_currency = row.target_currency
    model.target_unit = row.target_unit
    return model
