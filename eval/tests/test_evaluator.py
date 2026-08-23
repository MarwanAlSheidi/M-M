"""TESTS 18-26: metric correctness at every prediction level.

The fixtures here are hand-built so every expected number can be worked out on
paper. A metric test whose expected value comes from running the code proves
only that the code is deterministic.
"""

from __future__ import annotations

import pytest

from benchmark.evaluator import NULL_LABEL, Evaluator


def field_entry(
    raw=None,
    validated=None,
    canonical=None,
    final=None,
    decision="PREDICT",
    evidence_status="SUPPORTED",
    confidence=0.9,
):
    return {
        "raw": raw,
        "validated": validated,
        "canonical": canonical,
        "final": final,
        "decision": decision,
        "evidence_status": evidence_status,
        "confidence": confidence,
        "evidence": None,
    }


def predicted(value, **overrides):
    """A straightforward prediction: same value at all four levels."""
    base = dict(raw=value, validated=value, canonical=value, final=value)
    base.update(overrides)
    return field_entry(**base)


def abstained(raw=None, canonical=None):
    """An abstention: the raw answer is kept, the final value is null."""
    return field_entry(
        raw=raw,
        validated=raw,
        canonical=canonical,
        final=None,
        decision="ABSTAIN",
        evidence_status="ABSENT",
        confidence=0.0,
    )


@pytest.fixture
def two_field_evaluator(canonicalizer):
    """A deliberately small evaluator so metric arithmetic stays checkable."""
    return Evaluator(
        canonicalizer=canonicalizer,
        critical_fields=["silhouette"],
        secondary_fields=["fabric_family"],
        gold_columns={"silhouette": "silhouette_normalized", "fabric_family": "fabric_family"},
    )


@pytest.fixture
def gold_lookup():
    return {
        "P001": {"product_id": "P001", "silhouette_normalized": "butterfly", "fabric_family": "nida"},
        "P002": {"product_id": "P002", "silhouette_normalized": "kimono", "fabric_family": "crepe"},
        "P003": {"product_id": "P003", "silhouette_normalized": "", "fabric_family": "satin"},
        "P004": {"product_id": "P004", "silhouette_normalized": "cape", "fabric_family": ""},
    }


# ----------------------------------------------------------------------
# TEST 17-19: the four levels are scored independently
# ----------------------------------------------------------------------


def test_17_raw_prediction_is_preserved_and_scored(two_field_evaluator, gold_lookup):
    """TEST 17: the raw answer survives into evaluation untouched."""
    records = [
        {
            "product_id": "P001",
            # Raw is an out-of-taxonomy spelling; canonical/final are clean.
            "silhouette": field_entry(
                raw="Farasha", validated="Farasha", canonical="butterfly", final="butterfly"
            ),
            "fabric_family": predicted("nida"),
        }
    ]
    results = two_field_evaluator.evaluate(records, gold_lookup)

    record = results["per_record"][0]
    assert record["fields"]["silhouette"]["raw_value"] == "Farasha"
    # "Farasha" canonicalizes to butterfly, so it is correct at every level.
    assert record["fields"]["silhouette"]["raw_correct"] is True
    assert record["fields"]["silhouette"]["final_correct"] is True


def test_18_canonical_prediction_evaluated_correctly(two_field_evaluator, gold_lookup):
    """TEST 18: the canonical level scores the canonical value."""
    records = [
        {
            "product_id": "P001",
            "silhouette": field_entry(
                raw="spaceship", validated=None, canonical=None, final=None,
                decision="ABSTAIN", evidence_status="ABSENT",
            ),
            "fabric_family": predicted("nida"),
        }
    ]
    results = two_field_evaluator.evaluate(records, gold_lookup)
    field = results["per_record"][0]["fields"]["silhouette"]

    assert field["raw_correct"] is False        # "spaceship" != "butterfly"
    assert field["canonical_correct"] is False  # None != "butterfly"
    assert results["levels"]["canonical"]["field_metrics"]["silhouette"]["accuracy"] == 0.0


def test_19_final_prediction_evaluated_correctly(two_field_evaluator, gold_lookup):
    """TEST 19: an abstention scores as null at the final level."""
    records = [
        {
            "product_id": "P003",  # gold silhouette is null
            "silhouette": abstained(raw="butterfly", canonical="butterfly"),
            "fabric_family": predicted("satin"),
        }
    ]
    results = two_field_evaluator.evaluate(records, gold_lookup)
    field = results["per_record"][0]["fields"]["silhouette"]

    # Raw said "butterfly" against null gold — a hallucination.
    assert field["raw_correct"] is False
    # The abstention withdrew it, so the final answer matches null gold.
    assert field["final_correct"] is True
    assert results["levels"]["raw"]["field_metrics"]["silhouette"]["accuracy"] == 0.0
    assert results["levels"]["final"]["field_metrics"]["silhouette"]["accuracy"] == 1.0


def test_all_four_levels_are_reported(two_field_evaluator, gold_lookup):
    records = [
        {"product_id": "P001", "silhouette": predicted("butterfly"), "fabric_family": predicted("nida")}
    ]
    results = two_field_evaluator.evaluate(records, gold_lookup)
    assert set(results["levels"]) == {"raw", "validated", "canonical", "final"}


# ----------------------------------------------------------------------
# TEST 20-21: exact match
# ----------------------------------------------------------------------


def test_20_exact_match(two_field_evaluator, gold_lookup):
    """TEST 20: a record counts only when every evaluated field is correct."""
    records = [
        {  # both correct
            "product_id": "P001",
            "silhouette": predicted("butterfly"),
            "fabric_family": predicted("nida"),
        },
        {  # secondary field wrong -> not an exact match
            "product_id": "P002",
            "silhouette": predicted("kimono"),
            "fabric_family": predicted("satin"),
        },
    ]
    results = two_field_evaluator.evaluate(records, gold_lookup)

    assert results["levels"]["final"]["exact_match_count"] == 1
    assert results["levels"]["final"]["exact_match"] == 0.5
    assert results["per_record"][0]["exact_match"] is True
    assert results["per_record"][1]["exact_match"] is False


def test_21_critical_exact_match(two_field_evaluator, gold_lookup):
    """TEST 21: critical exact match ignores secondary-field errors."""
    records = [
        {  # critical right, secondary wrong
            "product_id": "P002",
            "silhouette": predicted("kimono"),
            "fabric_family": predicted("satin"),
        },
        {  # critical wrong
            "product_id": "P001",
            "silhouette": predicted("cape"),
            "fabric_family": predicted("nida"),
        },
    ]
    results = two_field_evaluator.evaluate(records, gold_lookup)

    assert results["levels"]["final"]["critical_exact_match_count"] == 1
    assert results["levels"]["final"]["critical_exact_match"] == 0.5
    assert results["per_record"][0]["critical_exact_match"] is True
    assert results["per_record"][0]["exact_match"] is False


# ----------------------------------------------------------------------
# TEST 22-23: abstention and selective accuracy
# ----------------------------------------------------------------------


def test_22_abstention_rate(two_field_evaluator, gold_lookup):
    """TEST 22: abstentions over total field predictions. 2 of 4 = 0.5."""
    records = [
        {
            "product_id": "P001",
            "silhouette": abstained(),
            "fabric_family": predicted("nida"),
        },
        {
            "product_id": "P002",
            "silhouette": abstained(),
            "fabric_family": predicted("crepe"),
        },
    ]
    results = two_field_evaluator.evaluate(records, gold_lookup)

    assert results["selective"]["decision_total"] == 4
    assert results["selective"]["abstain_count"] == 2
    assert results["selective"]["abstention_rate"] == 0.5


def test_23_selective_accuracy(two_field_evaluator, gold_lookup):
    """TEST 23: accuracy among non-abstained predictions only.

    Three PREDICT decisions, two of them right -> 2/3. The abstained field is
    excluded from both numerator and denominator even though it is *correct*
    against null gold, which is what makes selective accuracy different from
    plain accuracy.
    """
    records = [
        {
            "product_id": "P001",
            "silhouette": predicted("butterfly"),   # PREDICT, correct
            "fabric_family": predicted("satin"),    # PREDICT, wrong
        },
        {
            "product_id": "P003",
            "silhouette": abstained(),              # ABSTAIN, correct vs null gold
            "fabric_family": predicted("satin"),    # PREDICT, correct
        },
    ]
    results = two_field_evaluator.evaluate(records, gold_lookup)

    assert results["selective"]["selective_total"] == 3
    assert results["selective"]["selective_correct"] == 2
    assert results["selective"]["selective_accuracy"] == pytest.approx(2 / 3, abs=1e-6)


def test_selective_accuracy_is_zero_when_everything_abstains(two_field_evaluator, gold_lookup):
    """A zero denominator returns 0.0 rather than raising or yielding NaN."""
    records = [
        {"product_id": "P001", "silhouette": abstained(), "fabric_family": abstained()}
    ]
    results = two_field_evaluator.evaluate(records, gold_lookup)

    assert results["selective"]["selective_total"] == 0
    assert results["selective"]["selective_accuracy"] == 0.0


# ----------------------------------------------------------------------
# TEST 24-25: evidence metrics
# ----------------------------------------------------------------------


def test_24_evidence_support_rate(two_field_evaluator, gold_lookup):
    """TEST 24: SUPPORTED or PARTIAL over non-null final predictions.

    Three non-null finals; two carry supporting evidence -> 2/3. The abstained
    field has no final value, so it is outside the denominator entirely.
    """
    records = [
        {
            "product_id": "P001",
            "silhouette": predicted("butterfly", evidence_status="SUPPORTED"),
            "fabric_family": predicted("nida", evidence_status="PARTIAL"),
        },
        {
            "product_id": "P002",
            "silhouette": predicted("kimono", evidence_status="ABSENT"),
            "fabric_family": abstained(),
        },
    ]
    results = two_field_evaluator.evaluate(records, gold_lookup)

    assert results["evidence"]["non_null_final_count"] == 3
    assert results["evidence"]["supported_or_partial_count"] == 2
    assert results["evidence"]["evidence_support_rate"] == pytest.approx(2 / 3, abs=1e-6)


def test_25_evidence_conditioned_accuracy(two_field_evaluator, gold_lookup):
    """TEST 25: accuracy among predictions carrying supporting evidence.

    Two evidenced predictions, one correct -> 0.5. The unevidenced (and
    correct) prediction is excluded.
    """
    records = [
        {
            "product_id": "P001",
            "silhouette": predicted("butterfly", evidence_status="SUPPORTED"),  # correct
            "fabric_family": predicted("satin", evidence_status="PARTIAL"),     # wrong
        },
        {
            "product_id": "P002",
            "silhouette": predicted("kimono", evidence_status="ABSENT"),        # correct, excluded
            "fabric_family": predicted("crepe", evidence_status="ABSENT"),      # correct, excluded
        },
    ]
    results = two_field_evaluator.evaluate(records, gold_lookup)

    assert results["evidence"]["evidence_conditioned_total"] == 2
    assert results["evidence"]["evidence_conditioned_correct"] == 1
    assert results["evidence"]["evidence_conditioned_accuracy"] == 0.5


# ----------------------------------------------------------------------
# TEST 26: critical field error rate
# ----------------------------------------------------------------------


def test_26_critical_field_error_rate(two_field_evaluator, gold_lookup):
    """TEST 26: incorrect critical predictions over all critical predictions.

    Three records, one critical field each; one wrong -> 1/3.
    """
    records = [
        {"product_id": "P001", "silhouette": predicted("butterfly"), "fabric_family": predicted("nida")},
        {"product_id": "P002", "silhouette": predicted("cape"), "fabric_family": predicted("crepe")},
        {"product_id": "P004", "silhouette": predicted("cape"), "fabric_family": abstained()},
    ]
    results = two_field_evaluator.evaluate(records, gold_lookup)

    assert results["critical"]["critical_field_total"] == 3
    assert results["critical"]["critical_field_correct"] == 2
    assert results["critical"]["critical_field_error_rate"] == pytest.approx(1 / 3, abs=1e-6)


def test_critical_error_rate_is_zero_with_no_critical_fields(canonicalizer, gold_lookup):
    evaluator = Evaluator(
        canonicalizer=canonicalizer,
        critical_fields=[],
        secondary_fields=["fabric_family"],
        gold_columns={"fabric_family": "fabric_family"},
    )
    results = evaluator.evaluate(
        [{"product_id": "P001", "fabric_family": predicted("nida")}], gold_lookup
    )
    assert results["critical"]["critical_field_error_rate"] == 0.0


# ----------------------------------------------------------------------
# precision / recall / F1 / confusion matrix
# ----------------------------------------------------------------------


def test_precision_recall_f1_and_confusion_matrix(two_field_evaluator, gold_lookup):
    records = [
        {"product_id": "P001", "silhouette": predicted("butterfly"), "fabric_family": predicted("nida")},
        {"product_id": "P002", "silhouette": predicted("butterfly"), "fabric_family": predicted("crepe")},
    ]
    results = two_field_evaluator.evaluate(records, gold_lookup)
    metrics = results["levels"]["final"]["field_metrics"]["silhouette"]

    assert metrics["confusion_matrix"]["butterfly -> butterfly"] == 1
    assert metrics["confusion_matrix"]["kimono -> butterfly"] == 1

    # butterfly: tp=1 fp=1 -> precision 0.5, recall 1.0
    per_label = metrics["per_label"]
    assert per_label["butterfly"]["precision"] == 0.5
    assert per_label["butterfly"]["recall"] == 1.0
    assert per_label["kimono"]["recall"] == 0.0
    assert 0.0 <= metrics["f1"] <= 1.0


def test_null_label_used_for_matrix_bookkeeping(two_field_evaluator, gold_lookup):
    """Nulls appear as an explicit label, never as the string "nan"."""
    records = [
        {"product_id": "P003", "silhouette": abstained(), "fabric_family": predicted("satin")}
    ]
    results = two_field_evaluator.evaluate(records, gold_lookup)
    matrix = results["levels"]["final"]["field_metrics"]["silhouette"]["confusion_matrix"]

    assert f"{NULL_LABEL} -> {NULL_LABEL}" in matrix
    assert not any("nan" in key.lower() for key in matrix)


# ----------------------------------------------------------------------
# structure and safety
# ----------------------------------------------------------------------


def test_prediction_without_gold_is_reported_not_scored(two_field_evaluator, gold_lookup):
    """An unmatched prediction must not be silently scored against nothing."""
    records = [
        {"product_id": "GHOST", "silhouette": predicted("butterfly"), "fabric_family": predicted("nida")}
    ]
    results = two_field_evaluator.evaluate(records, gold_lookup)

    assert results["total_records"] == 0
    assert results["skipped_predictions_without_gold"] == ["GHOST"]


def test_empty_predictions_produce_zeros_not_errors(two_field_evaluator, gold_lookup):
    results = two_field_evaluator.evaluate([], gold_lookup)

    assert results["total_records"] == 0
    assert results["headline"]["macro_accuracy"] == 0.0
    assert results["headline"]["exact_match"] == 0.0
    assert results["selective"]["abstention_rate"] == 0.0


def test_headline_block_reads_from_the_final_level(two_field_evaluator, gold_lookup):
    records = [
        {"product_id": "P001", "silhouette": predicted("butterfly"), "fabric_family": predicted("nida")}
    ]
    results = two_field_evaluator.evaluate(records, gold_lookup)

    assert results["headline"]["macro_accuracy"] == results["levels"]["final"]["macro_accuracy"]
    assert results["headline"]["exact_match"] == results["levels"]["final"]["exact_match"]
