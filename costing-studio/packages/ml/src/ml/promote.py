"""Champion/challenger gate. Challenger must also beat the ridge baseline."""
from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, Optional

import numpy as np


@dataclass
class PromotionDecision:
    promoted: bool
    reason: str


def should_promote(champion_metrics: Dict[str, float], challenger_metrics: Dict[str, float],
                   baseline_metrics: Optional[Dict[str, float]] = None,
                   min_mape_improvement_rel: float = 0.05,
                   max_coverage_drop: float = 0.05) -> PromotionDecision:
    if not challenger_metrics.get("n_folds"):
        return PromotionDecision(False, "challenger has no folds")

    chal = challenger_metrics.get("mape_mean", float("nan"))
    if np.isnan(chal):
        return PromotionDecision(False, "challenger mape not computable")

    if baseline_metrics and baseline_metrics.get("n_folds"):
        base = baseline_metrics.get("mape_mean", float("nan"))
        if not np.isnan(base) and chal >= base:
            return PromotionDecision(False, f"challenger {chal:.4f} not better than ridge baseline {base:.4f}")

    if not champion_metrics.get("n_folds"):
        return PromotionDecision(True, "no champion yet")

    champ = champion_metrics["mape_mean"]
    if champ == 0 or np.isnan(champ):
        return PromotionDecision(False, "mape not comparable")

    rel_gain = (champ - chal) / champ
    cov_drop = champion_metrics["coverage_mean"] - challenger_metrics["coverage_mean"]
    if rel_gain < min_mape_improvement_rel:
        return PromotionDecision(False, f"relative mape gain {rel_gain:.4f} < {min_mape_improvement_rel}")
    if cov_drop > max_coverage_drop:
        return PromotionDecision(False, f"coverage drop {cov_drop:.4f} > {max_coverage_drop}")
    return PromotionDecision(True, f"rel mape -{rel_gain:.4f}, coverage drop {cov_drop:.4f}")
