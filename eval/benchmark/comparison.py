"""Model-to-model comparison.

Everything here compares models **on identical records**. A comparison over
different record sets is not a comparison, and the functions refuse rather than
silently intersecting.

Two cautions are built into the output rather than left to the reader:

* Overlapping confidence intervals are not a significance test, and
  non-overlapping ones are not either. The paired McNemar result is reported
  separately and is the only inferential number here.
* Agreement is not correctness. Models can agree and all be wrong; consensus is
  never treated as gold.
"""

from __future__ import annotations

import csv
import os
from typing import Any, Dict, List, Optional, Sequence

from .statistics import DEFAULT_CONFIDENCE, mcnemar_test, safe_ratio, wilson_interval

# Flat columns for the comparison table. Kept deliberately shallow so the CSV
# opens usefully in Excel, Power BI or a notebook without reshaping.
COMPARISON_COLUMNS = (
    "model",
    "provider",
    "model_id",
    "dataset_kind",
    "records",
    "accuracy",
    "accuracy_ci_low",
    "accuracy_ci_high",
    "exact_match",
    "exact_match_ci_low",
    "exact_match_ci_high",
    "critical_exact_match",
    "macro_f1",
    "abstention_rate",
    "selective_accuracy",
    "evidence_support_rate",
    "critical_error_rate",
    "total_cost",
    "currency",
    "cost_per_correct_record",
    "mean_latency_ms",
    "p95_latency_ms",
    "success_rate",
    "failure_rate",
    "retry_rate",
    "determinism_supported",
)


def _record_ids(evaluation: Dict[str, Any]) -> List[str]:
    return [str(record["product_id"]) for record in evaluation.get("per_record", [])]


def build_model_row(result: Dict[str, Any], confidence: float = DEFAULT_CONFIDENCE) -> Dict[str, Any]:
    """One flat row summarising a single model's run."""
    headline = result.get("headline", {})
    final = result.get("levels", {}).get("final", {})
    cost = result.get("cost", {})
    operations = result.get("operations", {})
    run = result.get("run", {})

    total_observations = final.get("total_observations", 0)
    total_correct = final.get("total_correct", 0)
    records = result.get("total_records", 0)

    accuracy_ci = wilson_interval(total_correct, total_observations, confidence)
    exact_ci = wilson_interval(final.get("exact_match_count", 0), records, confidence)

    return {
        "model": run.get("model_key", result.get("model_key", "unknown")),
        "provider": run.get("provider"),
        "model_id": run.get("model_id"),
        "dataset_kind": run.get("dataset_kind"),
        "records": records,
        "accuracy": headline.get("micro_accuracy"),
        "accuracy_ci_low": accuracy_ci["low"],
        "accuracy_ci_high": accuracy_ci["high"],
        "exact_match": headline.get("exact_match"),
        "exact_match_ci_low": exact_ci["low"],
        "exact_match_ci_high": exact_ci["high"],
        "critical_exact_match": headline.get("critical_exact_match"),
        "macro_f1": headline.get("macro_f1"),
        "abstention_rate": headline.get("abstention_rate"),
        "selective_accuracy": headline.get("selective_accuracy"),
        "evidence_support_rate": headline.get("evidence_support_rate"),
        "critical_error_rate": headline.get("critical_field_error_rate"),
        "total_cost": cost.get("total_cost"),
        "currency": cost.get("currency"),
        "cost_per_correct_record": cost.get("cost_per_correct_record"),
        "mean_latency_ms": operations.get("mean_latency_ms"),
        "p95_latency_ms": operations.get("p95_latency_ms"),
        "success_rate": operations.get("success_rate"),
        "failure_rate": operations.get("failure_rate"),
        "retry_rate": operations.get("retry_rate"),
        "determinism_supported": run.get("determinism_supported"),
    }


def paired_correctness(
    result_a: Dict[str, Any],
    result_b: Dict[str, Any],
    level: str = "final",
) -> Dict[str, Any]:
    """Per-record paired correctness between two models.

    Uses record-level exact match at ``level``: a record counts as correct for
    a model only when every evaluated field is correct. Records missing from
    either model are excluded and counted, never silently dropped.
    """
    index_a = {str(r["product_id"]): r for r in result_a.get("per_record", [])}
    index_b = {str(r["product_id"]): r for r in result_b.get("per_record", [])}

    shared = sorted(set(index_a) & set(index_b))
    only_in_a = sorted(set(index_a) - set(index_b))
    only_in_b = sorted(set(index_b) - set(index_a))

    key = "exact_match" if level == "final" else f"{level}_exact_match"

    both_correct = a_only = b_only = both_wrong = 0
    disagreements: List[str] = []

    for product_id in shared:
        correct_a = bool(index_a[product_id].get(key))
        correct_b = bool(index_b[product_id].get(key))

        if correct_a and correct_b:
            both_correct += 1
        elif correct_a and not correct_b:
            a_only += 1
            disagreements.append(product_id)
        elif correct_b and not correct_a:
            b_only += 1
            disagreements.append(product_id)
        else:
            both_wrong += 1

    test = mcnemar_test(both_correct, a_only, b_only, both_wrong)

    return {
        "model_a": result_a.get("run", {}).get("model_key"),
        "model_b": result_b.get("run", {}).get("model_key"),
        "level": level,
        "compared_records": len(shared),
        "records_only_in_a": only_in_a,
        "records_only_in_b": only_in_b,
        "both_correct": both_correct,
        "a_wins": a_only,
        "b_wins": b_only,
        "ties": both_correct + both_wrong,
        "both_wrong": both_wrong,
        "disagreement_ids": disagreements,
        "mcnemar": test,
        "caution": (
            "Confidence intervals overlapping or not overlapping is not a "
            "significance test. Use the paired McNemar result."
        ),
    }


def field_comparison(
    results: Dict[str, Dict[str, Any]],
    fields: Sequence[str],
    critical_fields: Sequence[str],
) -> Dict[str, Any]:
    """Field × model matrix of accuracy, F1, abstention and evidence support."""
    matrix: Dict[str, Dict[str, Dict[str, Any]]] = {}
    best: Dict[str, Optional[str]] = {}
    worst: Dict[str, Optional[str]] = {}

    for field in fields:
        matrix[field] = {}

        for model_key, result in results.items():
            field_metrics = (
                result.get("levels", {})
                .get("final", {})
                .get("field_metrics", {})
                .get(field, {})
            )
            per_field_ops = result.get("per_field_operations", {}).get(field, {})

            matrix[field][model_key] = {
                "accuracy": field_metrics.get("accuracy"),
                "f1": field_metrics.get("f1"),
                "precision": field_metrics.get("precision"),
                "recall": field_metrics.get("recall"),
                "abstention_rate": per_field_ops.get("abstention_rate"),
                "evidence_support_rate": per_field_ops.get("evidence_support_rate"),
                "is_critical": field in critical_fields,
            }

        scored = [
            (model_key, values["accuracy"])
            for model_key, values in matrix[field].items()
            if values["accuracy"] is not None
        ]
        best[field] = max(scored, key=lambda kv: kv[1])[0] if scored else None
        worst[field] = min(scored, key=lambda kv: kv[1])[0] if scored else None

    # Critical-field winner: highest mean accuracy across critical fields only.
    critical_means: Dict[str, float] = {}
    for model_key in results:
        values = [
            matrix[field][model_key]["accuracy"]
            for field in critical_fields
            if field in matrix and matrix[field][model_key]["accuracy"] is not None
        ]
        if values:
            critical_means[model_key] = round(sum(values) / len(values), 6)

    critical_winner = (
        max(critical_means.items(), key=lambda kv: kv[1])[0] if critical_means else None
    )

    return {
        "matrix": matrix,
        "best_model_per_field": best,
        "worst_model_per_field": worst,
        "critical_field_mean_accuracy": critical_means,
        "critical_field_winner": critical_winner,
    }


def model_agreement(
    results: Dict[str, Dict[str, Any]],
    fields: Sequence[str],
) -> Dict[str, Any]:
    """Agreement between models on identical records and fields.

    Agreement is a measure of *consistency*, not of truth. The output
    separately counts the case that matters most for interpretation: every
    model agreeing on an answer that is wrong.
    """
    model_keys = sorted(results)
    if len(model_keys) < 2:
        return {
            "models": model_keys,
            "note": "Agreement needs at least two models.",
            "comparable_records": 0,
        }

    indexes = {
        key: {str(r["product_id"]): r for r in results[key].get("per_record", [])}
        for key in model_keys
    }
    shared = sorted(set.intersection(*(set(index) for index in indexes.values())))

    unanimous = majority = 0
    unanimous_and_wrong = 0
    total_slots = 0
    full_disagreement_ids: List[str] = []
    pairwise: Dict[str, Dict[str, int]] = {}

    for product_id in shared:
        for field in fields:
            values = []
            correctness = []

            for key in model_keys:
                field_result = indexes[key][product_id].get("fields", {}).get(field, {})
                values.append(field_result.get("final_value"))
                correctness.append(bool(field_result.get("final_correct")))

            total_slots += 1
            distinct = {"__NULL__" if v is None else str(v).lower() for v in values}

            if len(distinct) == 1:
                unanimous += 1
                if not any(correctness):
                    # Everyone agreed, everyone was wrong. Consensus is not gold.
                    unanimous_and_wrong += 1
            elif len(distinct) == len(model_keys):
                full_disagreement_ids.append(f"{product_id}:{field}")

            counts: Dict[str, int] = {}
            for value in values:
                token = "__NULL__" if value is None else str(value).lower()
                counts[token] = counts.get(token, 0) + 1
            if counts and max(counts.values()) > len(model_keys) / 2:
                majority += 1

            for i, key_a in enumerate(model_keys):
                for key_b in model_keys[i + 1 :]:
                    pair = f"{key_a}|{key_b}"
                    pairwise.setdefault(pair, {"agree": 0, "total": 0})
                    pairwise[pair]["total"] += 1

                    a_value = values[model_keys.index(key_a)]
                    b_value = values[model_keys.index(key_b)]
                    a_token = "__NULL__" if a_value is None else str(a_value).lower()
                    b_token = "__NULL__" if b_value is None else str(b_value).lower()
                    if a_token == b_token:
                        pairwise[pair]["agree"] += 1

    return {
        "models": model_keys,
        "comparable_records": len(shared),
        "field_slots": total_slots,
        "unanimous_agreement_rate": safe_ratio(unanimous, total_slots),
        "majority_agreement_rate": safe_ratio(majority, total_slots),
        "unanimous_but_incorrect": unanimous_and_wrong,
        "unanimous_but_incorrect_rate": safe_ratio(unanimous_and_wrong, unanimous),
        "full_disagreement_slots": full_disagreement_ids[:200],
        "full_disagreement_count": len(full_disagreement_ids),
        "pairwise_agreement": {
            pair: safe_ratio(counts["agree"], counts["total"])
            for pair, counts in sorted(pairwise.items())
        },
        "caution": "Agreement is not correctness. Consensus is never treated as gold.",
    }


def compare_models(
    results: Dict[str, Dict[str, Any]],
    fields: Sequence[str],
    critical_fields: Sequence[str],
    confidence: float = DEFAULT_CONFIDENCE,
) -> Dict[str, Any]:
    """Full comparison document across every model in ``results``."""
    model_keys = sorted(results)
    rows = [build_model_row(results[key], confidence) for key in model_keys]

    record_sets = {key: set(_record_ids(results[key])) for key in model_keys}
    identical_records = len({frozenset(ids) for ids in record_sets.values()}) <= 1

    pairs: List[Dict[str, Any]] = []
    for i, key_a in enumerate(model_keys):
        for key_b in model_keys[i + 1 :]:
            pairs.append(paired_correctness(results[key_a], results[key_b]))

    return {
        "models": model_keys,
        "confidence_level": confidence,
        "identical_record_sets": identical_records,
        "rows": rows,
        "paired": pairs,
        "fields": field_comparison(results, fields, critical_fields),
        "agreement": model_agreement(results, fields),
        "notes": [
            "All models evaluated the same records with the same prompt hash.",
            "Confidence intervals are Wilson score intervals; overlap is not a test.",
            "Agreement measures consistency between models, never correctness.",
        ],
    }


def write_comparison_csv(comparison: Dict[str, Any], path: str) -> str:
    """Flat CSV of the comparison rows, for spreadsheets and dashboards."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)

    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(COMPARISON_COLUMNS))
        writer.writeheader()
        for row in comparison.get("rows", []):
            writer.writerow({column: row.get(column) for column in COMPARISON_COLUMNS})

    return path
