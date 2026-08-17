"""Error categorization.

Turns "this prediction was wrong" into "wrong in this specific way", which is
what actually drives a fix: a model producing values outside the taxonomy needs
a prompt change, one abstaining too often needs an evidence-policy change, and
one hallucinating against null gold needs neither.

The rule that matters is at the bottom: when the record does not contain enough
information to say which category applies, the answer is ``UNKNOWN_ERROR``.
Guessing a category produces a tidy pie chart that misdirects the next week of
work.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from .evidence_verifier import ABSENT, UNSUPPORTED
from .utils import normalize_null

# Categories, ordered by how specific they are: the first that applies wins.
INVALID_TAXONOMY = "INVALID_TAXONOMY"
WRONG_CLASS = "WRONG_CLASS"
MISSING_VALUE = "MISSING_VALUE"
FALSE_POSITIVE = "FALSE_POSITIVE"
FALSE_NEGATIVE = "FALSE_NEGATIVE"
EVIDENCE_UNSUPPORTED = "EVIDENCE_UNSUPPORTED"
EVIDENCE_ABSENT = "EVIDENCE_ABSENT"
LOW_CONFIDENCE = "LOW_CONFIDENCE"
ABSTENTION = "ABSTENTION"
PARSING_ERROR = "PARSING_ERROR"
PROVIDER_ERROR = "PROVIDER_ERROR"
UNKNOWN_ERROR = "UNKNOWN_ERROR"
CORRECT = "CORRECT"

ALL_CATEGORIES = (
    INVALID_TAXONOMY,
    WRONG_CLASS,
    MISSING_VALUE,
    FALSE_POSITIVE,
    FALSE_NEGATIVE,
    EVIDENCE_UNSUPPORTED,
    EVIDENCE_ABSENT,
    LOW_CONFIDENCE,
    ABSTENTION,
    PARSING_ERROR,
    PROVIDER_ERROR,
    UNKNOWN_ERROR,
)

LOW_CONFIDENCE_THRESHOLD = 0.35


def categorize_field_error(
    field_entry: Dict[str, Any],
    gold_value: Any,
    is_correct: bool,
    record_error: Optional[str] = None,
    record_error_category: Optional[str] = None,
) -> str:
    """Classify one incorrect field prediction.

    ``field_entry`` is the four-layer record the pipeline built.
    """
    if is_correct:
        return CORRECT

    # Record-level failures explain every field at once, so they come first.
    if record_error:
        if record_error_category in ("parsing", "schema"):
            return PARSING_ERROR
        return PROVIDER_ERROR

    reason = field_entry.get("reason")
    decision = field_entry.get("decision")
    evidence_status = field_entry.get("evidence_status")
    confidence = field_entry.get("confidence")

    gold = normalize_null(gold_value)
    raw = normalize_null(field_entry.get("raw"))
    final = normalize_null(field_entry.get("final"))

    # The model produced something outside the taxonomy.
    if reason == "invalid_taxonomy_value":
        return INVALID_TAXONOMY

    if reason and str(reason).startswith("unsupported_type:"):
        return PARSING_ERROR

    if reason == "classifier_error":
        return PROVIDER_ERROR

    # Withdrawn answers: distinguish *why* it was withdrawn, because the fixes
    # differ. An evidence-absent abstention is a policy outcome; a plain
    # abstention against non-null gold is a miss.
    if decision == "ABSTAIN" and gold is not None:
        if reason == "evidence_absent":
            return EVIDENCE_ABSENT
        if raw is not None:
            return ABSTENTION
        return MISSING_VALUE

    if final is None and gold is not None:
        return FALSE_NEGATIVE

    if final is not None and gold is None:
        # Answered where gold says there was nothing to answer.
        if evidence_status == UNSUPPORTED:
            return EVIDENCE_UNSUPPORTED
        if evidence_status == ABSENT:
            return EVIDENCE_ABSENT
        return FALSE_POSITIVE

    if final is not None and gold is not None:
        if evidence_status == UNSUPPORTED:
            return EVIDENCE_UNSUPPORTED
        if isinstance(confidence, (int, float)) and confidence < LOW_CONFIDENCE_THRESHOLD:
            return LOW_CONFIDENCE
        return WRONG_CLASS

    # Both null but scored incorrect should be impossible; if it happens the
    # honest answer is that this record does not explain itself.
    return UNKNOWN_ERROR


def summarize_errors(per_record: Any, fields: Any) -> Dict[str, Any]:
    """Aggregate categories over evaluated records.

    Expects evaluator ``per_record`` results that already carry an
    ``error_category`` per field (added by :func:`annotate_errors`).
    """
    by_category: Dict[str, int] = {}
    by_field: Dict[str, Dict[str, int]] = {field: {} for field in fields}
    total_errors = 0

    for record in per_record:
        for field, values in record.get("fields", {}).items():
            category = values.get("error_category")
            if not category or category == CORRECT:
                continue

            total_errors += 1
            by_category[category] = by_category.get(category, 0) + 1
            by_field.setdefault(field, {})
            by_field[field][category] = by_field[field].get(category, 0) + 1

    return {
        "total_errors": total_errors,
        "by_category": dict(sorted(by_category.items(), key=lambda kv: -kv[1])),
        "by_field": by_field,
        "categories": list(ALL_CATEGORIES),
    }


def annotate_errors(
    evaluation: Dict[str, Any],
    predictions: Any,
) -> Dict[str, Any]:
    """Attach an ``error_category`` to every field of every evaluated record.

    Mutates the evaluation document in place and returns it, then adds the
    aggregate under ``error_analysis``.
    """
    prediction_index = {
        str(record.get("product_id")): record for record in predictions
    }

    for record in evaluation.get("per_record", []):
        product_id = str(record.get("product_id"))
        source = prediction_index.get(product_id, {})
        record_error = source.get("error")
        record_error_category = source.get("error_category")

        for field, values in record.get("fields", {}).items():
            field_entry = source.get(field) or {}
            values["error_category"] = categorize_field_error(
                field_entry=field_entry,
                gold_value=values.get("gold"),
                is_correct=bool(values.get("final_correct")),
                record_error=record_error,
                record_error_category=record_error_category,
            )

    evaluation["error_analysis"] = summarize_errors(
        evaluation.get("per_record", []),
        evaluation.get("fields", {}).get("evaluated", []),
    )
    return evaluation
