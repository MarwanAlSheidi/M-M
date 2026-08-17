"""TESTS 46-51: confidence intervals, paired tests, comparison, fields, agreement, errors."""

from __future__ import annotations

import pytest

from benchmark.comparison import (
    compare_models,
    field_comparison,
    model_agreement,
    paired_correctness,
)
from benchmark.error_analysis import (
    ABSTENTION,
    CORRECT,
    EVIDENCE_ABSENT,
    FALSE_POSITIVE,
    INVALID_TAXONOMY,
    PARSING_ERROR,
    PROVIDER_ERROR,
    UNKNOWN_ERROR,
    WRONG_CLASS,
    categorize_field_error,
)
from benchmark.statistics import mcnemar_test, wilson_interval


# ----------------------------------------------------------------------
# TEST 46: confidence intervals
# ----------------------------------------------------------------------


def test_46_wilson_interval_brackets_the_point_estimate():
    """TEST 46: a 95% Wilson interval contains the point and stays in [0,1]."""
    interval = wilson_interval(80, 100)

    assert interval["point"] == 0.8
    assert interval["low"] < 0.8 < interval["high"]
    assert 0.0 <= interval["low"] <= 1.0
    assert 0.0 <= interval["high"] <= 1.0
    assert interval["method"] == "wilson"
    assert interval["confidence"] == 0.95


def test_46b_perfect_score_still_has_width():
    """The reason for Wilson: 100/100 must not claim zero uncertainty.

    The normal approximation collapses to [1.0, 1.0] here, which would assert
    certainty from a hundred observations.
    """
    interval = wilson_interval(100, 100)

    assert interval["point"] == 1.0
    assert interval["low"] < 1.0
    assert interval["high"] == 1.0


def test_46c_zero_score_stays_within_bounds():
    interval = wilson_interval(0, 50)
    assert interval["point"] == 0.0
    assert interval["low"] == 0.0
    assert interval["high"] > 0.0


def test_46d_interval_narrows_as_the_sample_grows():
    small = wilson_interval(8, 10)
    large = wilson_interval(800, 1000)
    assert (large["high"] - large["low"]) < (small["high"] - small["low"])


def test_46e_no_observations_gives_null_bounds_not_zero():
    """No data is not the same as a measured zero."""
    interval = wilson_interval(0, 0)
    assert interval["low"] is None
    assert interval["high"] is None
    assert interval["n"] == 0


def test_46f_unsupported_confidence_level_is_rejected():
    with pytest.raises(ValueError, match="Unsupported confidence"):
        wilson_interval(1, 2, confidence=0.83)


# ----------------------------------------------------------------------
# TEST 47: paired comparison
# ----------------------------------------------------------------------


def make_result(model_key, correctness, field_values=None):
    """A minimal evaluation document: {product_id: exact_match bool}."""
    per_record = []
    for product_id, correct in correctness.items():
        fields = {}
        for field, values in (field_values or {}).items():
            fields[field] = {
                "final_value": values.get(product_id),
                "final_correct": correct,
            }
        per_record.append(
            {"product_id": product_id, "exact_match": correct, "fields": fields}
        )

    return {
        "run": {"model_key": model_key, "provider": "local"},
        "per_record": per_record,
        "headline": {},
        "levels": {"final": {"field_metrics": {}}},
    }


def test_47_paired_comparison_counts_wins_and_ties():
    """TEST 47: paired correctness on identical records."""
    a = make_result("a", {"P1": True, "P2": True, "P3": False, "P4": False})
    b = make_result("b", {"P1": True, "P2": False, "P3": True, "P4": False})

    paired = paired_correctness(a, b)

    assert paired["compared_records"] == 4
    assert paired["both_correct"] == 1     # P1
    assert paired["a_wins"] == 1           # P2
    assert paired["b_wins"] == 1           # P3
    assert paired["both_wrong"] == 1       # P4
    assert set(paired["disagreement_ids"]) == {"P2", "P3"}


def test_47b_mcnemar_uses_only_discordant_pairs():
    """Records both models agree on carry no information about which is better."""
    lopsided = mcnemar_test(both_correct=0, only_a_correct=10, only_b_correct=0, both_wrong=0)
    padded = mcnemar_test(both_correct=500, only_a_correct=10, only_b_correct=0, both_wrong=500)

    assert lopsided["p_value"] == padded["p_value"]
    assert padded["discordant_pairs"] == 10


def test_47c_mcnemar_exact_binomial_for_small_samples():
    """10 discordant pairs all favouring A: p = 2 · 0.5^10 = 0.001953125."""
    result = mcnemar_test(0, 10, 0, 0)

    assert result["method"] == "exact_binomial"
    assert result["p_value"] == pytest.approx(0.001953125)


def test_47d_mcnemar_switches_to_chi_square_for_large_samples():
    result = mcnemar_test(0, 30, 10, 0)

    assert result["method"] == "chi_square_yates"
    # (|30-10| - 1)^2 / 40 = 361/40 = 9.025
    assert result["statistic"] == pytest.approx(9.025)
    assert 0.0 < result["p_value"] < 0.01


def test_47e_no_discordant_pairs_is_p_one():
    result = mcnemar_test(10, 0, 0, 5)
    assert result["p_value"] == 1.0
    assert result["method"] == "none"


def test_47f_symmetric_disagreement_is_not_significant():
    result = mcnemar_test(0, 5, 5, 0)
    assert result["p_value"] == 1.0


def test_47g_paired_result_carries_the_overlap_caution():
    a = make_result("a", {"P1": True})
    b = make_result("b", {"P1": False})
    assert "not a" in paired_correctness(a, b)["caution"].lower()


def test_47h_records_missing_from_one_model_are_reported_not_dropped():
    a = make_result("a", {"P1": True, "P2": True})
    b = make_result("b", {"P1": True})

    paired = paired_correctness(a, b)
    assert paired["compared_records"] == 1
    assert paired["records_only_in_a"] == ["P2"]


# ----------------------------------------------------------------------
# TEST 48: model comparison
# ----------------------------------------------------------------------


def full_result(model_key, accuracy, correct, total, records, exact):
    return {
        "run": {
            "model_key": model_key,
            "provider": "local",
            "model_id": model_key,
            "dataset_kind": "fixture",
            "determinism_supported": True,
        },
        "total_records": records,
        "headline": {
            "micro_accuracy": accuracy,
            "exact_match": exact / records,
            "critical_exact_match": 0.5,
            "macro_f1": 0.9,
            "abstention_rate": 0.1,
            "selective_accuracy": 0.95,
            "evidence_support_rate": 0.8,
            "critical_field_error_rate": 0.2,
        },
        "levels": {
            "final": {
                "total_correct": correct,
                "total_observations": total,
                "exact_match_count": exact,
                "field_metrics": {
                    "silhouette": {"accuracy": accuracy, "f1": 0.9, "correct": correct,
                                   "total": total, "precision": 0.9, "recall": 0.9},
                    "fabric_family": {"accuracy": 0.5, "f1": 0.5, "correct": 1,
                                      "total": 2, "precision": 0.5, "recall": 0.5},
                },
            }
        },
        "cost": {"total_cost": 0.01, "currency": "USD", "cost_per_correct_record": 0.002},
        "operations": {"mean_latency_ms": 12.0, "p95_latency_ms": 20.0,
                       "success_rate": 1.0, "failure_rate": 0.0, "retry_rate": 0.0},
        "per_field_operations": {
            "silhouette": {"abstention_rate": 0.1, "evidence_support_rate": 0.9},
            "fabric_family": {"abstention_rate": 0.2, "evidence_support_rate": 0.7},
        },
        "per_record": [
            {"product_id": f"P{i}", "exact_match": i <= exact, "fields": {
                "silhouette": {"final_value": "butterfly", "final_correct": i <= exact},
                "fabric_family": {"final_value": "nida", "final_correct": i <= exact},
            }}
            for i in range(1, records + 1)
        ],
    }


def test_48_model_comparison_produces_one_row_per_model():
    """TEST 48: a flat comparison row per model, with intervals attached."""
    results = {
        "model_a": full_result("model_a", 0.9, 90, 100, 10, 8),
        "model_b": full_result("model_b", 0.7, 70, 100, 10, 5),
    }
    comparison = compare_models(results, ["silhouette", "fabric_family"], ["silhouette"])

    assert comparison["models"] == ["model_a", "model_b"]
    assert len(comparison["rows"]) == 2
    assert comparison["identical_record_sets"] is True

    row = next(r for r in comparison["rows"] if r["model"] == "model_a")
    assert row["accuracy"] == 0.9
    assert row["accuracy_ci_low"] < 0.9 < row["accuracy_ci_high"]
    assert row["total_cost"] == 0.01
    assert row["mean_latency_ms"] == 12.0
    assert row["success_rate"] == 1.0


def test_48b_comparison_detects_differing_record_sets():
    a = full_result("a", 0.9, 9, 10, 5, 4)
    b = full_result("b", 0.9, 9, 10, 3, 2)

    comparison = compare_models({"a": a, "b": b}, ["silhouette"], ["silhouette"])
    assert comparison["identical_record_sets"] is False


def test_48c_comparison_includes_paired_tests_for_every_pair():
    results = {
        "a": full_result("a", 0.9, 9, 10, 5, 4),
        "b": full_result("b", 0.8, 8, 10, 5, 3),
        "c": full_result("c", 0.7, 7, 10, 5, 2),
    }
    comparison = compare_models(results, ["silhouette"], ["silhouette"])
    assert len(comparison["paired"]) == 3   # 3 choose 2


# ----------------------------------------------------------------------
# TEST 49: field comparison
# ----------------------------------------------------------------------


def test_49_field_matrix_names_best_and_worst_per_field():
    """TEST 49: field × model matrix with per-field winners."""
    results = {
        "strong": full_result("strong", 0.95, 95, 100, 10, 9),
        "weak": full_result("weak", 0.60, 60, 100, 10, 4),
    }
    matrix = field_comparison(results, ["silhouette", "fabric_family"], ["silhouette"])

    assert matrix["matrix"]["silhouette"]["strong"]["accuracy"] == 0.95
    assert matrix["matrix"]["silhouette"]["strong"]["is_critical"] is True
    assert matrix["matrix"]["fabric_family"]["strong"]["is_critical"] is False

    assert matrix["best_model_per_field"]["silhouette"] == "strong"
    assert matrix["worst_model_per_field"]["silhouette"] == "weak"
    assert matrix["critical_field_winner"] == "strong"


def test_49b_field_matrix_carries_abstention_and_evidence():
    results = {"a": full_result("a", 0.9, 9, 10, 5, 4)}
    matrix = field_comparison(results, ["silhouette"], ["silhouette"])

    cell = matrix["matrix"]["silhouette"]["a"]
    assert cell["abstention_rate"] == 0.1
    assert cell["evidence_support_rate"] == 0.9


# ----------------------------------------------------------------------
# TEST 50: agreement
# ----------------------------------------------------------------------


def test_50_agreement_is_measured_but_never_treated_as_truth():
    """TEST 50: unanimous, majority and pairwise agreement, plus the trap."""
    a = make_result("a", {"P1": False, "P2": True},
                    field_values={"silhouette": {"P1": "butterfly", "P2": "kimono"}})
    b = make_result("b", {"P1": False, "P2": True},
                    field_values={"silhouette": {"P1": "butterfly", "P2": "kimono"}})

    agreement = model_agreement({"a": a, "b": b}, ["silhouette"])

    assert agreement["comparable_records"] == 2
    assert agreement["unanimous_agreement_rate"] == 1.0
    # Both agreed on P1 and both were wrong. Consensus is not gold.
    assert agreement["unanimous_but_incorrect"] == 1
    assert agreement["pairwise_agreement"]["a|b"] == 1.0
    assert "not correctness" in agreement["caution"].lower()


def test_50b_full_disagreement_is_identified():
    a = make_result("a", {"P1": True}, field_values={"silhouette": {"P1": "butterfly"}})
    b = make_result("b", {"P1": False}, field_values={"silhouette": {"P1": "kimono"}})

    agreement = model_agreement({"a": a, "b": b}, ["silhouette"])

    assert agreement["unanimous_agreement_rate"] == 0.0
    assert agreement["full_disagreement_count"] == 1


def test_50c_agreement_needs_two_models():
    a = make_result("a", {"P1": True}, field_values={"silhouette": {"P1": "butterfly"}})
    agreement = model_agreement({"a": a}, ["silhouette"])
    assert "at least two" in agreement["note"]


def test_50d_null_predictions_agree_with_each_other():
    a = make_result("a", {"P1": True}, field_values={"silhouette": {"P1": None}})
    b = make_result("b", {"P1": True}, field_values={"silhouette": {"P1": None}})

    agreement = model_agreement({"a": a, "b": b}, ["silhouette"])
    assert agreement["unanimous_agreement_rate"] == 1.0


# ----------------------------------------------------------------------
# TEST 51: error categorization
# ----------------------------------------------------------------------


def entry(**overrides):
    base = {
        "raw": "butterfly",
        "validated": "butterfly",
        "canonical": "butterfly",
        "final": "butterfly",
        "decision": "PREDICT",
        "evidence_status": "SUPPORTED",
        "confidence": 0.9,
        "reason": "evidence_supported",
    }
    base.update(overrides)
    return base


def test_51_correct_predictions_are_categorized_as_correct():
    assert categorize_field_error(entry(), "butterfly", True) == CORRECT


def test_51b_invalid_taxonomy_value():
    result = categorize_field_error(
        entry(raw="spaceship", validated=None, canonical=None, final=None,
              decision="ABSTAIN", reason="invalid_taxonomy_value"),
        "butterfly", False,
    )
    assert result == INVALID_TAXONOMY


def test_51c_wrong_class():
    result = categorize_field_error(
        entry(raw="kimono", canonical="kimono", final="kimono"), "butterfly", False
    )
    assert result == WRONG_CLASS


def test_51d_false_positive_against_null_gold():
    result = categorize_field_error(entry(), None, False)
    assert result == FALSE_POSITIVE


def test_51e_evidence_absent_abstention():
    result = categorize_field_error(
        entry(final=None, decision="ABSTAIN", reason="evidence_absent",
              evidence_status="ABSENT", confidence=0.0),
        "butterfly", False,
    )
    assert result == EVIDENCE_ABSENT


def test_51f_abstention_against_gold():
    result = categorize_field_error(
        entry(final=None, decision="ABSTAIN", reason="null_prediction",
              evidence_status="ABSENT", confidence=0.0),
        "butterfly", False,
    )
    assert result == ABSTENTION


def test_51g_provider_and_parsing_errors_are_distinguished():
    provider = categorize_field_error(
        entry(), "butterfly", False,
        record_error="429 rate limited", record_error_category="transient",
    )
    parsing = categorize_field_error(
        entry(), "butterfly", False,
        record_error="json_decode_error", record_error_category="parsing",
    )

    assert provider == PROVIDER_ERROR
    assert parsing == PARSING_ERROR


def test_51h_unsupported_type_is_a_parsing_error():
    result = categorize_field_error(
        entry(raw=["butterfly"], final=None, decision="ABSTAIN",
              reason="unsupported_type:list"),
        "butterfly", False,
    )
    assert result == PARSING_ERROR


def test_51i_unknown_when_the_record_does_not_explain_itself():
    """A category is never guessed. Insufficient evidence yields UNKNOWN_ERROR."""
    result = categorize_field_error(
        entry(raw=None, validated=None, canonical=None, final=None,
              decision="PREDICT", reason=None, evidence_status=None),
        None, False,
    )
    assert result == UNKNOWN_ERROR
