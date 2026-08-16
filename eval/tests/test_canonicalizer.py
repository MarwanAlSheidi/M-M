"""TESTS 8-11: null equality, synonym mapping, and correctness authority."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest


# ----------------------------------------------------------------------
# TEST 8-9: null semantics
# ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "gold,prediction",
    [
        (None, None),
        (float("nan"), None),
        (None, float("nan")),
        (pd.NA, None),
        ("", None),
        ("   ", None),
        ("nan", None),
        ("null", None),
        ("NULL", ""),
        (np.nan, pd.NA),
    ],
)
def test_08_null_equals_null(canonicalizer, gold, prediction):
    """TEST 8: null == null is correct, in every spelling of null."""
    assert canonicalizer.is_correct(gold, prediction, "silhouette") is True


@pytest.mark.parametrize(
    "gold,prediction",
    [
        (None, "butterfly"),
        ("butterfly", None),
        (float("nan"), "butterfly"),
        ("butterfly", float("nan")),
        ("", "butterfly"),
        ("butterfly", "   "),
    ],
)
def test_09_null_does_not_equal_value(canonicalizer, gold, prediction):
    """TEST 9: null against a value is incorrect in both directions."""
    assert canonicalizer.is_correct(gold, prediction, "silhouette") is False


# ----------------------------------------------------------------------
# TEST 10-11: synonym maps
# ----------------------------------------------------------------------


def test_10_ai_synonym_maps_correctly(canonicalizer):
    """TEST 10: an AI synonym canonicalizes to its taxonomy value."""
    assert canonicalizer.canonicalize_ai("Farasha", "silhouette") == "butterfly"
    assert canonicalizer.canonicalize_ai("KLOSH CUT", "silhouette") == "klosh"
    assert canonicalizer.canonicalize_ai("Stone/Crystal", "embellishment_type") == "stone / crystal"
    assert canonicalizer.canonicalize_ai("maroon", "color_normalized") == "burgundy"


def test_11_gold_synonym_maps_correctly(canonicalizer):
    """TEST 11: a gold synonym canonicalizes to its taxonomy value."""
    assert canonicalizer.canonicalize_gold("Farasha", "silhouette") == "butterfly"
    assert canonicalizer.canonicalize_gold("Navy Blue", "color_normalized") == "navy"
    assert canonicalizer.canonicalize_gold("Stones", "embellishment_type") == "stone / crystal"


def test_synonym_maps_are_per_field_not_global(canonicalizer):
    """The bug that motivated per-field maps: "stone" is a colour too.

    A flat map rewrote a colour of "stone" into the embellishment value
    "stone / crystal" — a label absent from the colour taxonomy, which then
    scored as an error on every affected row.
    """
    assert canonicalizer.canonicalize_gold("stone", "embellishment_type") == "stone / crystal"
    assert canonicalizer.canonicalize_gold("stone", "color_normalized") == "stone"
    assert canonicalizer.canonicalize_ai("crystal", "fabric_variant") == "crystal"


def test_gold_and_ai_maps_are_independent(canonicalizer):
    """An AI-only synonym must not silently rewrite gold."""
    assert canonicalizer.canonicalize_ai("wine", "color_normalized") == "burgundy"
    assert canonicalizer.canonicalize_gold("wine", "color_normalized") == "wine"


def test_unknown_value_survives_canonicalization(canonicalizer):
    """An unknown value stays a value: swallowing it would hide a wrong answer."""
    assert canonicalizer.canonicalize_ai("spaceship", "silhouette") == "spaceship"
    assert canonicalizer.is_correct("butterfly", "spaceship", "silhouette") is False


def test_case_and_whitespace_are_not_differences(canonicalizer):
    assert canonicalizer.is_correct("Butterfly", "  BUTTERFLY  ", "silhouette") is True


def test_containers_are_not_labels(canonicalizer):
    """A list must not stringify into a label like "['a', 'b']"."""
    assert canonicalizer.canonicalize_ai(["butterfly"], "silhouette") is None
    assert canonicalizer.canonicalize_ai({"value": "butterfly"}, "silhouette") is None


def test_numeric_values_are_handled(canonicalizer):
    assert canonicalizer.canonicalize_ai(42, "silhouette") == "42"
    assert canonicalizer.is_correct(42, "42", "silhouette") is True


def test_unknown_map_type_is_rejected(canonicalizer):
    with pytest.raises(ValueError):
        canonicalizer.canonicalize("butterfly", "silhouette", map_type="nonsense")
