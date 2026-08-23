"""TESTS 12-16: taxonomy validation, evidence handling, inference policy."""

from __future__ import annotations

import pandas as pd
import pytest

from benchmark.evidence_verifier import ABSENT, PARTIAL, SUPPORTED, UNSUPPORTED
from benchmark.validator import ABSTAIN, PREDICT, UNKNOWN

NO_EVIDENCE_TEXT = "عباية يومية بسيطة"
BUTTERFLY_TEXT = "Open-front butterfly abaya in black nida"


# ----------------------------------------------------------------------
# TEST 12: invalid taxonomy value
# ----------------------------------------------------------------------


def test_12_invalid_taxonomy_value_abstains(validator):
    """TEST 12: a value outside the taxonomy -> ABSTAIN, flagged invalid."""
    result = validator.validate_field(
        "silhouette", "spaceship", confidence=0.99, source_text="spaceship abaya"
    )

    assert result["decision"] == ABSTAIN
    assert result["valid"] is False
    assert result["reason"] == "invalid_taxonomy_value"
    assert result["canonical_value"] is None
    assert result["confidence"] == 0.0


def test_12b_valid_synonym_is_not_invalid(validator):
    """A synonym is a valid value; only genuinely unknown values abstain."""
    result = validator.validate_field(
        "silhouette", "Farasha", confidence=0.9, source_text="farasha abaya"
    )

    assert result["valid"] is True
    assert result["canonical_value"] == "butterfly"
    assert result["decision"] == PREDICT


# ----------------------------------------------------------------------
# TEST 13-14: evidence-required fields
# ----------------------------------------------------------------------


def test_13_evidence_required_and_absent_abstains(validator):
    """TEST 13: evidence required + absent evidence -> ABSTAIN."""
    assert "silhouette" in validator.evidence_required
    assert "silhouette" not in validator.inference_allowed

    result = validator.validate_field(
        "silhouette", "butterfly", confidence=0.95, source_text=NO_EVIDENCE_TEXT
    )

    assert result["evidence_status"] == ABSENT
    assert result["decision"] == ABSTAIN
    assert result["confidence"] == 0.0
    assert result["reason"] == "evidence_absent"
    # The value is still recorded — abstention is a decision, not an erasure.
    assert result["canonical_value"] == "butterfly"


def test_14_evidence_required_and_supported_predicts(validator):
    """TEST 14: evidence required + supported evidence -> prediction allowed."""
    result = validator.validate_field(
        "silhouette", "butterfly", confidence=0.9, source_text=BUTTERFLY_TEXT
    )

    assert result["evidence_status"] == SUPPORTED
    assert result["decision"] == PREDICT
    assert result["confidence"] == 0.9
    assert result["confidence_penalty"] == 0.0


def test_14b_partial_evidence_caps_confidence(validator):
    """PARTIAL evidence predicts, but the confidence is capped at 0.7."""
    result = validator.validate_field(
        "embroidery_type",
        "machine embroidery",
        confidence=0.95,
        source_text="abaya with delicate machine work",
    )

    assert result["evidence_status"] == PARTIAL
    assert result["decision"] == PREDICT
    assert result["confidence"] == pytest.approx(0.7)
    assert result["confidence_penalty"] == pytest.approx(0.25)


def test_14c_unsupported_evidence_caps_confidence_hard(validator):
    """Text supporting a competing value caps confidence at 0.3."""
    result = validator.validate_field(
        "silhouette",
        "butterfly",
        confidence=0.9,
        source_text="Closed-front kimono abaya in navy satin",
    )

    assert result["evidence_status"] == UNSUPPORTED
    assert result["decision"] == PREDICT
    assert result["confidence"] == pytest.approx(0.3)


# ----------------------------------------------------------------------
# TEST 15-16: inference policy
# ----------------------------------------------------------------------


def test_15_inference_allowed_absent_evidence_predicts_with_cap(validator):
    """TEST 15: inference-allowed + absent evidence -> predict, capped at 0.6."""
    assert "fabric_family" in validator.inference_allowed

    result = validator.validate_field(
        "fabric_family", "nida", confidence=0.95, source_text=NO_EVIDENCE_TEXT
    )

    assert result["evidence_status"] == ABSENT
    assert result["decision"] == PREDICT
    assert result["confidence"] == pytest.approx(0.6)
    assert result["reason"] == "inferred_without_evidence"
    assert result["confidence_penalty"] == pytest.approx(0.35)


def test_16_inference_not_allowed_absent_evidence_abstains(validator):
    """TEST 16: inference not allowed + absent evidence -> ABSTAIN."""
    for field, value in (
        ("embellishment_type", "beadwork"),
        ("embellishment_intensity", "heavy"),
        ("opening_type", "open-front"),
    ):
        assert field not in validator.inference_allowed

        result = validator.validate_field(
            field, value, confidence=0.99, source_text=NO_EVIDENCE_TEXT
        )
        assert result["decision"] == ABSTAIN, field
        assert result["confidence"] == 0.0, field


def test_16b_default_for_unlisted_field_is_strict(validator):
    """A field in neither policy list must not inherit permission to guess."""
    unlisted = [
        field
        for field in validator.taxonomy
        if field not in validator.inference_allowed
        and field not in validator.evidence_required
    ]
    for field in unlisted:
        value = validator.taxonomy[field][0]
        result = validator.validate_field(
            field, value, confidence=0.9, source_text=NO_EVIDENCE_TEXT
        )
        assert result["decision"] == ABSTAIN, field


# ----------------------------------------------------------------------
# nulls, types and edge cases
# ----------------------------------------------------------------------


@pytest.mark.parametrize("value", [None, float("nan"), pd.NA, "", "   ", "null", "none"])
def test_null_prediction_is_valid_abstention(validator, value):
    """A null answer is the model declining to guess: valid, and an abstention."""
    result = validator.validate_field("silhouette", value, confidence=0.8)

    assert result["valid"] is True
    assert result["decision"] == ABSTAIN
    assert result["confidence"] == 0.0
    assert result["value"] is None
    assert result["reason"] == "null_prediction"


@pytest.mark.parametrize("value", [["butterfly"], {"value": "butterfly"}, True, ("a",)])
def test_unsupported_type_is_invalid_abstention(validator, value):
    """A container or bool is a schema violation, not a wrong answer."""
    result = validator.validate_field("silhouette", value, confidence=0.8)

    assert result["valid"] is False
    assert result["decision"] == ABSTAIN
    assert result["reason"].startswith("unsupported_type:")


def test_unknown_field_returns_unknown_decision(validator):
    result = validator.validate_field("not_a_field", "butterfly", confidence=0.9)

    assert result["decision"] == UNKNOWN
    assert result["valid"] is False
    assert result["reason"] == "unknown_field"


@pytest.mark.parametrize(
    "confidence,expected",
    [(None, 0.0), ("0.5", 0.5), (5, 1.0), (-3, 0.0), ("abc", 0.0), (float("nan"), 0.0)],
)
def test_confidence_is_clamped(validator, confidence, expected):
    result = validator.validate_field(
        "fabric_family", "nida", confidence=confidence, source_text="nida abaya"
    )
    assert result["confidence"] <= 1.0
    assert result["confidence"] >= 0.0
    if expected == 0.0 and confidence in (None, "abc"):
        assert result["confidence"] == 0.0


def test_validate_field_always_returns_the_full_contract(validator):
    """Every branch returns every key: downstream code never has to guess."""
    expected_keys = {
        "value",
        "confidence",
        "evidence",
        "valid",
        "reason",
        "evidence_status",
        "confidence_penalty",
        "canonical_value",
        "decision",
    }
    for value in [None, "butterfly", "spaceship", ["x"], 42]:
        result = validator.validate_field("silhouette", value, source_text=BUTTERFLY_TEXT)
        assert set(result) == expected_keys


def test_validate_prediction_accepts_bare_values(validator):
    """Both {"field": "value"} and the full {"value","confidence"} form work."""
    bare = validator.validate_prediction({"silhouette": "butterfly"}, BUTTERFLY_TEXT)
    structured = validator.validate_prediction(
        {"silhouette": {"value": "butterfly", "confidence": 0.9}}, BUTTERFLY_TEXT
    )

    assert bare["silhouette"]["canonical_value"] == "butterfly"
    assert structured["silhouette"]["canonical_value"] == "butterfly"


def test_validate_prediction_covers_every_field_even_when_absent(validator):
    """A model omitting fields must not shrink the evaluation denominator."""
    validated = validator.validate_prediction({}, BUTTERFLY_TEXT)

    assert set(validated) == set(validator.fields)
    assert all(entry["decision"] == ABSTAIN for entry in validated.values())


def test_abstained_prediction_structure(validator):
    """TEST 32 (part): the safe structure used when the classifier fails."""
    abstained = validator.abstained_prediction()

    assert set(abstained) == set(validator.fields)
    for entry in abstained.values():
        assert entry["decision"] == ABSTAIN
        assert entry["value"] is None
        assert entry["confidence"] == 0.0
        assert entry["reason"] == "classifier_error"
