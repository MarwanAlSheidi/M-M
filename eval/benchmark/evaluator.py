"""Evaluation.

Every correctness decision in this module goes through
``Canonicalizer.is_correct``. There is deliberately no string comparison, no
``.lower()``, and no synonym lookup here — a second implementation of
"are these the same?" is how two runs come to disagree about the same data.

Metrics are computed at four prediction levels:

``raw``        exactly what the classifier emitted
``validated``  after schema, taxonomy and evidence validation
``canonical``  the canonical form of the validated value
``final``      what the benchmark actually scores (abstentions become null)

The four usually agree. When they don't, the gap *is* the finding: a large
raw-to-final drop means the model is answering outside the taxonomy or without
evidence, which no single accuracy number would show.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Sequence

from .canonicalizer import Canonicalizer
from .evidence_verifier import PARTIAL, SUPPORTED
from .utils import normalize_null

LEVELS = ("raw", "validated", "canonical", "final")

# Explicit label for "no value" in confusion matrices and per-label precision
# and recall. Only used for label bookkeeping — never for correctness, which
# is always the canonicalizer's answer.
NULL_LABEL = "__NULL__"


def _safe_ratio(numerator: float, denominator: float) -> float:
    """Zero denominators return 0.0 rather than raising or yielding NaN."""
    if not denominator:
        return 0.0
    return round(numerator / denominator, 6)


class Evaluator:
    """Scores a set of final prediction records against gold."""

    def __init__(
        self,
        canonicalizer: Canonicalizer,
        critical_fields: Sequence[str],
        secondary_fields: Sequence[str],
        gold_columns: Optional[Dict[str, str]] = None,
    ) -> None:
        self.canonicalizer = canonicalizer
        self.critical_fields = list(critical_fields)
        self.secondary_fields = list(secondary_fields)
        self.gold_columns = dict(gold_columns or {})

    # ------------------------------------------------------------------

    @property
    def fields(self) -> List[str]:
        """All evaluated fields: critical first, then secondary."""
        ordered = list(self.critical_fields)
        ordered += [f for f in self.secondary_fields if f not in ordered]
        return ordered

    def gold_column(self, field: str) -> str:
        return self.gold_columns.get(field, field)

    # ------------------------------------------------------------------
    # value extraction
    # ------------------------------------------------------------------

    @staticmethod
    def _value_at_level(entry: Any, level: str) -> Any:
        """Pull one prediction level out of a per-field record."""
        if not isinstance(entry, dict):
            # A bare value only exists at the raw level; the other levels are
            # undefined for it rather than equal to it.
            return entry if level == "raw" else None

        if level == "raw":
            return entry.get("raw")
        if level == "validated":
            return entry.get("validated")
        if level == "canonical":
            return entry.get("canonical")
        if level == "final":
            return entry.get("final")
        raise ValueError(f"Unknown prediction level: {level!r}")

    def _label(self, value: Any, field: str, is_gold: bool) -> str:
        """Canonical label for matrix bookkeeping, with an explicit null."""
        canonical = (
            self.canonicalizer.canonicalize_gold(value, field)
            if is_gold
            else self.canonicalizer.canonicalize_ai(value, field)
        )
        return NULL_LABEL if canonical is None else canonical

    # ------------------------------------------------------------------
    # main entry point
    # ------------------------------------------------------------------

    def evaluate(
        self,
        predictions: Iterable[Dict[str, Any]],
        gold_lookup: Dict[str, Dict[str, Any]],
        cost_summary: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Score every record and return the complete result document."""
        predictions = list(predictions)
        fields = self.fields

        levels: Dict[str, Any] = {level: self._empty_level(fields) for level in LEVELS}
        per_record: List[Dict[str, Any]] = []

        abstain_count = 0
        unknown_count = 0
        decision_total = 0

        selective_correct = 0
        selective_total = 0

        evidence_supported_count = 0
        non_null_final_count = 0
        evidence_conditioned_correct = 0
        evidence_conditioned_total = 0

        critical_correct = 0
        critical_total = 0

        skipped_ids: List[str] = []

        for record in predictions:
            product_id = str(record.get("product_id", "")).strip()
            gold_row = gold_lookup.get(product_id)

            if gold_row is None:
                # No gold for this prediction. Scoring it against nothing would
                # invent a result, so it is reported, not guessed at.
                skipped_ids.append(product_id)
                continue

            record_result = self._evaluate_record(
                record=record,
                gold_row=gold_row,
                fields=fields,
                levels=levels,
            )
            per_record.append(record_result)

            for field in fields:
                entry = record.get(field)
                if not isinstance(entry, dict):
                    continue

                decision = entry.get("decision")
                decision_total += 1
                if decision == "ABSTAIN":
                    abstain_count += 1
                elif decision == "UNKNOWN":
                    unknown_count += 1

                correct_final = record_result["fields"][field]["final_correct"]

                if decision == "PREDICT":
                    selective_total += 1
                    selective_correct += 1 if correct_final else 0

                final_value = normalize_null(self._value_at_level(entry, "final"))
                evidence_status = entry.get("evidence_status")

                if final_value is not None:
                    non_null_final_count += 1
                    if evidence_status in (SUPPORTED, PARTIAL):
                        evidence_supported_count += 1

                if evidence_status in (SUPPORTED, PARTIAL):
                    evidence_conditioned_total += 1
                    evidence_conditioned_correct += 1 if correct_final else 0

                if field in self.critical_fields:
                    critical_total += 1
                    critical_correct += 1 if correct_final else 0

        total_records = len(per_record)

        results: Dict[str, Any] = {
            "total_records": total_records,
            "predictions_seen": len(predictions),
            "skipped_predictions_without_gold": skipped_ids,
            "fields": {
                "critical": list(self.critical_fields),
                "secondary": list(self.secondary_fields),
                "evaluated": fields,
            },
            "levels": {},
            "per_record": per_record,
        }

        for level in LEVELS:
            results["levels"][level] = self._finalize_level(
                levels[level], fields, total_records
            )

        results["selective"] = {
            "abstention_rate": _safe_ratio(abstain_count, decision_total),
            "abstain_count": abstain_count,
            "unknown_count": unknown_count,
            "decision_total": decision_total,
            "selective_accuracy": _safe_ratio(selective_correct, selective_total),
            "selective_correct": selective_correct,
            "selective_total": selective_total,
        }

        results["evidence"] = {
            "evidence_support_rate": _safe_ratio(
                evidence_supported_count, non_null_final_count
            ),
            "supported_or_partial_count": evidence_supported_count,
            "non_null_final_count": non_null_final_count,
            "evidence_conditioned_accuracy": _safe_ratio(
                evidence_conditioned_correct, evidence_conditioned_total
            ),
            "evidence_conditioned_correct": evidence_conditioned_correct,
            "evidence_conditioned_total": evidence_conditioned_total,
        }

        results["critical"] = {
            "critical_field_error_rate": _safe_ratio(
                critical_total - critical_correct, critical_total
            ),
            "critical_field_correct": critical_correct,
            "critical_field_total": critical_total,
        }

        results["cost"] = cost_summary or {}

        # Headline numbers, lifted from the level that is actually scored.
        final_level = results["levels"]["final"]
        results["headline"] = {
            "macro_accuracy": final_level["macro_accuracy"],
            "micro_accuracy": final_level["micro_accuracy"],
            "exact_match": final_level["exact_match"],
            "critical_exact_match": final_level["critical_exact_match"],
            "macro_f1": final_level["macro_f1"],
            "abstention_rate": results["selective"]["abstention_rate"],
            "selective_accuracy": results["selective"]["selective_accuracy"],
            "critical_field_error_rate": results["critical"]["critical_field_error_rate"],
            "evidence_support_rate": results["evidence"]["evidence_support_rate"],
        }

        return results

    # ------------------------------------------------------------------
    # per level bookkeeping
    # ------------------------------------------------------------------

    @staticmethod
    def _empty_level(fields: Sequence[str]) -> Dict[str, Any]:
        return {
            "field_correct": {field: 0 for field in fields},
            "field_total": {field: 0 for field in fields},
            "confusion": {field: {} for field in fields},
            "exact_match_count": 0,
            "critical_exact_match_count": 0,
        }

    def _evaluate_record(
        self,
        record: Dict[str, Any],
        gold_row: Dict[str, Any],
        fields: Sequence[str],
        levels: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Score one record at all four levels."""
        product_id = str(record.get("product_id", "")).strip()
        field_results: Dict[str, Any] = {}

        level_all_correct = {level: True for level in LEVELS}
        level_critical_correct = {level: True for level in LEVELS}

        for field in fields:
            entry = record.get(field)
            gold_value = gold_row.get(self.gold_column(field))
            gold_label = self._label(gold_value, field, is_gold=True)

            per_field: Dict[str, Any] = {
                "gold": gold_value,
                "gold_canonical": None if gold_label == NULL_LABEL else gold_label,
                "decision": entry.get("decision") if isinstance(entry, dict) else None,
                "evidence_status": (
                    entry.get("evidence_status") if isinstance(entry, dict) else None
                ),
                "confidence": entry.get("confidence") if isinstance(entry, dict) else None,
            }

            for level in LEVELS:
                predicted = self._value_at_level(entry, level)
                correct = self.canonicalizer.is_correct(gold_value, predicted, field)

                per_field[f"{level}_value"] = predicted
                per_field[f"{level}_correct"] = correct

                bucket = levels[level]
                bucket["field_total"][field] += 1
                if correct:
                    bucket["field_correct"][field] += 1
                else:
                    level_all_correct[level] = False
                    if field in self.critical_fields:
                        level_critical_correct[level] = False

                predicted_label = self._label(predicted, field, is_gold=False)
                key = f"{gold_label} -> {predicted_label}"
                bucket["confusion"][field][key] = (
                    bucket["confusion"][field].get(key, 0) + 1
                )

            field_results[field] = per_field

        for level in LEVELS:
            if level_all_correct[level]:
                levels[level]["exact_match_count"] += 1
            if level_critical_correct[level]:
                levels[level]["critical_exact_match_count"] += 1

        return {
            "product_id": product_id,
            "error": record.get("error"),
            "fields": field_results,
            "exact_match": level_all_correct["final"],
            "critical_exact_match": level_critical_correct["final"],
            "raw_exact_match": level_all_correct["raw"],
            "raw_critical_exact_match": level_critical_correct["raw"],
        }

    def _finalize_level(
        self,
        bucket: Dict[str, Any],
        fields: Sequence[str],
        total_records: int,
    ) -> Dict[str, Any]:
        """Turn per-level counters into the reported metric block."""
        field_metrics: Dict[str, Any] = {}
        accuracies: List[float] = []
        f1_scores: List[float] = []

        total_correct = 0
        total_observations = 0

        for field in fields:
            correct = bucket["field_correct"][field]
            total = bucket["field_total"][field]
            accuracy = _safe_ratio(correct, total)

            total_correct += correct
            total_observations += total
            accuracies.append(accuracy)

            prf = self._precision_recall_f1(bucket["confusion"][field])
            f1_scores.append(prf["macro_f1"])

            field_metrics[field] = {
                "accuracy": accuracy,
                "correct": correct,
                "total": total,
                "errors": total - correct,
                "precision": prf["macro_precision"],
                "recall": prf["macro_recall"],
                "f1": prf["macro_f1"],
                "per_label": prf["per_label"],
                "confusion_matrix": dict(bucket["confusion"][field]),
                "is_critical": field in self.critical_fields,
            }

        return {
            "macro_accuracy": _safe_ratio(sum(accuracies), len(accuracies)),
            "micro_accuracy": _safe_ratio(total_correct, total_observations),
            "macro_f1": _safe_ratio(sum(f1_scores), len(f1_scores)),
            "exact_match": _safe_ratio(bucket["exact_match_count"], total_records),
            "exact_match_count": bucket["exact_match_count"],
            "critical_exact_match": _safe_ratio(
                bucket["critical_exact_match_count"], total_records
            ),
            "critical_exact_match_count": bucket["critical_exact_match_count"],
            "field_metrics": field_metrics,
            "total_correct": total_correct,
            "total_observations": total_observations,
        }

    # ------------------------------------------------------------------
    # precision / recall / F1 from a confusion matrix
    # ------------------------------------------------------------------

    @staticmethod
    def _precision_recall_f1(confusion: Dict[str, int]) -> Dict[str, Any]:
        """Macro-averaged precision, recall and F1 over observed labels.

        Computed from the ``"gold -> predicted"`` counts rather than a library
        call, so the benchmark carries no scikit-learn dependency for four
        arithmetic operations. Labels are macro-averaged over every label that
        appears as gold or as a prediction, ``__NULL__`` included: declining to
        answer is a class the benchmark cares about.
        """
        true_positive: Dict[str, int] = {}
        false_positive: Dict[str, int] = {}
        false_negative: Dict[str, int] = {}
        labels = set()

        for key, count in confusion.items():
            gold_label, _, predicted_label = key.partition(" -> ")
            labels.add(gold_label)
            labels.add(predicted_label)

            if gold_label == predicted_label:
                true_positive[gold_label] = true_positive.get(gold_label, 0) + count
            else:
                false_negative[gold_label] = false_negative.get(gold_label, 0) + count
                false_positive[predicted_label] = (
                    false_positive.get(predicted_label, 0) + count
                )

        per_label: Dict[str, Dict[str, float]] = {}
        precisions: List[float] = []
        recalls: List[float] = []
        f1s: List[float] = []

        for label in sorted(labels):
            tp = true_positive.get(label, 0)
            fp = false_positive.get(label, 0)
            fn = false_negative.get(label, 0)

            precision = _safe_ratio(tp, tp + fp)
            recall = _safe_ratio(tp, tp + fn)
            f1 = _safe_ratio(2 * precision * recall, precision + recall)

            per_label[label] = {
                "precision": precision,
                "recall": recall,
                "f1": f1,
                "support": tp + fn,
            }
            precisions.append(precision)
            recalls.append(recall)
            f1s.append(f1)

        return {
            "macro_precision": _safe_ratio(sum(precisions), len(precisions)),
            "macro_recall": _safe_ratio(sum(recalls), len(recalls)),
            "macro_f1": _safe_ratio(sum(f1s), len(f1s)),
            "per_label": per_label,
        }
