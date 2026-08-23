"""Human audit sampling.

Automatic metrics cannot tell you whether *gold* is wrong. This module selects
the records most likely to repay a human look, ranked by how much doubt they
carry, and writes them in a form a reviewer can work through without opening
the codebase.

Selection is deterministic — same inputs, same sample — so a review can be
repeated and two reviewers can be given the identical set.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from .error_analysis import CORRECT
from .evidence_verifier import UNSUPPORTED
from .utils import safe_str

# Reasons a record is worth a human look, most informative first. The weight
# decides ordering when a record qualifies for several.
REASON_WEIGHTS = {
    "critical_field_incorrect": 100,
    "model_disagreement": 80,
    "evidence_unsupported": 60,
    "provider_or_parsing_error": 55,
    "abstention_against_gold": 40,
    "low_confidence": 20,
}

LOW_CONFIDENCE_THRESHOLD = 0.5


def _reasons_for_record(
    record: Dict[str, Any],
    critical_fields: Sequence[str],
    disagreement_ids: Optional[set] = None,
) -> List[str]:
    reasons: List[str] = []
    product_id = str(record.get("product_id"))

    if record.get("error"):
        reasons.append("provider_or_parsing_error")

    if disagreement_ids and product_id in disagreement_ids:
        reasons.append("model_disagreement")

    for field, values in record.get("fields", {}).items():
        correct = bool(values.get("final_correct"))
        category = values.get("error_category")

        if not correct and field in critical_fields:
            reasons.append("critical_field_incorrect")

        if values.get("evidence_status") == UNSUPPORTED:
            reasons.append("evidence_unsupported")

        if not correct and category in ("ABSTENTION", "EVIDENCE_ABSENT", "FALSE_NEGATIVE"):
            reasons.append("abstention_against_gold")

        confidence = values.get("confidence")
        if (
            isinstance(confidence, (int, float))
            and 0 < confidence < LOW_CONFIDENCE_THRESHOLD
            and not correct
        ):
            reasons.append("low_confidence")

    # Stable order, no duplicates.
    return sorted(set(reasons), key=lambda reason: -REASON_WEIGHTS.get(reason, 0))


def build_review_sample(
    results_by_model: Dict[str, Dict[str, Any]],
    source_texts: Dict[str, str],
    critical_fields: Sequence[str],
    limit: int = 25,
    disagreement_ids: Optional[set] = None,
) -> List[Dict[str, Any]]:
    """Select up to ``limit`` records for human review, most doubtful first."""
    if not results_by_model:
        return []

    candidates: Dict[str, Dict[str, Any]] = {}

    for model_key, result in results_by_model.items():
        for record in result.get("per_record", []):
            product_id = str(record.get("product_id"))
            reasons = _reasons_for_record(record, critical_fields, disagreement_ids)
            if not reasons:
                continue

            entry = candidates.setdefault(
                product_id,
                {
                    "product_id": product_id,
                    "source_text": source_texts.get(product_id, ""),
                    "gold": {},
                    "model_predictions": {},
                    "confidence": {},
                    "evidence": {},
                    "error_category": {},
                    "review_reason": set(),
                },
            )

            entry["review_reason"].update(reasons)

            fields = record.get("fields", {})
            if not entry["gold"]:
                entry["gold"] = {
                    field: values.get("gold_canonical") for field, values in fields.items()
                }

            entry["model_predictions"][model_key] = {
                field: values.get("final_value") for field, values in fields.items()
            }
            entry["confidence"][model_key] = {
                field: values.get("confidence") for field, values in fields.items()
            }
            entry["evidence"][model_key] = {
                field: values.get("evidence_status") for field, values in fields.items()
            }
            entry["error_category"][model_key] = {
                field: values.get("error_category")
                for field, values in fields.items()
                if values.get("error_category") not in (None, CORRECT)
            }

    scored = []
    for entry in candidates.values():
        reasons = sorted(entry["review_reason"], key=lambda r: -REASON_WEIGHTS.get(r, 0))
        entry["review_reason"] = reasons
        entry["review_priority"] = sum(REASON_WEIGHTS.get(reason, 0) for reason in reasons)
        scored.append(entry)

    # Priority first, then product_id so ties resolve identically every run.
    scored.sort(key=lambda entry: (-entry["review_priority"], entry["product_id"]))
    return scored[: max(0, int(limit))]


def source_text_index(dataset_rows: Sequence[Dict[str, Any]]) -> Dict[str, str]:
    """product_id -> the text a reviewer needs to judge the record."""
    index: Dict[str, str] = {}
    for row in dataset_rows:
        product_id = safe_str(row.get("product_id")).strip()
        if not product_id:
            continue
        name = safe_str(row.get("product_name_raw")).strip()
        description = safe_str(row.get("description_raw")).strip()
        index[product_id] = f"{name}\n{description}".strip()
    return index
