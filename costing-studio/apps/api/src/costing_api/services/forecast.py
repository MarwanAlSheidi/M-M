"""Champion forecast of the forward purchase price. Advisory: never a landed cost, never a quote override."""
from __future__ import annotations
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Optional

import pandas as pd

from ..repos import model_repo
from ..schemas import SHAPFeature
from .features import build_features

TARGET = "forward_purchase_price_per_kg"


@dataclass(frozen=True)
class Forecast:
    p10: Decimal
    p50: Decimal
    p90: Decimal
    shap_top5: list[SHAPFeature]
    model_version: str
    target_currency: str
    target_unit: str


def _shap_top5(model, feats: pd.DataFrame) -> list[SHAPFeature]:
    row = model.explain(feats).iloc[0].drop(labels=["__bias__"], errors="ignore")
    top = row.abs().sort_values(ascending=False).head(5).index
    return [SHAPFeature(feature=f, contribution=float(row[f])) for f in top]


def champion_forecast(session, tenant_id, product, deal_date: date,
                      currency: str) -> tuple[Optional[Forecast], Optional[str]]:
    """Returns (forecast, skip_reason); exactly one is set."""
    model = model_repo.get_champion(session, tenant_id, TARGET)
    if model is None:
        return None, "no champion model"
    feats, skip = build_features(session, tenant_id, product, deal_date, currency)
    if skip:
        return None, skip
    preds = model.predict(feats)
    p10, p50, p90 = (Decimal(str(preds[c].iloc[0])) for c in ("p10", "p50", "p90"))
    return Forecast(p10=p10, p50=p50, p90=p90, shap_top5=_shap_top5(model, feats),
                    model_version=model.version, target_currency=model.target_currency or "USD",
                    target_unit=model.target_unit or "kg"), None
