"""Utility contracts and the edge cases that silently corrupt benchmarks."""

from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd
import pytest

from benchmark.auditor import Auditor, sanitize_for_json
from benchmark.canonicalizer import Canonicalizer
from benchmark.evidence_verifier import ABSENT, PARTIAL, SUPPORTED, UNSUPPORTED
from benchmark.exceptions import ConfigError
from benchmark.leakage_detector import LeakageDetector, load_training_ids, normalize_id
from benchmark.utils import (
    compute_dict_hash,
    compute_file_hash,
    is_empty_value,
    normalize_null,
    safe_str,
)


# ----------------------------------------------------------------------
# null handling
# ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "value",
    [None, float("nan"), np.nan, pd.NA, pd.NaT, "", "   ", "nan", "NaN", "null", "NULL", "none", "<NA>"],
)
def test_every_spelling_of_null_normalizes_to_none(value):
    assert normalize_null(value) is None
    assert is_empty_value(value) is True


@pytest.mark.parametrize("value", ["butterfly", 0, 0.0, "0", "false", [], {}, ["a"]])
def test_real_values_are_not_null(value):
    assert is_empty_value(value) is False
    assert normalize_null(value) is not None or value in ([], {})


def test_zero_is_not_null():
    """0 and 0.0 are values. Treating them as null loses real data."""
    assert normalize_null(0) == 0
    assert normalize_null(0.0) == 0.0


def test_empty_container_is_not_a_null_scalar():
    """An empty list is a type error at the call site, not a missing value."""
    assert is_empty_value([]) is False
    assert is_empty_value({}) is False


@pytest.mark.parametrize("value", [None, float("nan"), pd.NA, ""])
def test_safe_str_never_returns_the_word_nan(value):
    assert safe_str(value) == ""


def test_safe_str_passes_real_values_through():
    assert safe_str("Butterfly") == "Butterfly"
    assert safe_str(42) == "42"


def test_normalize_null_does_not_raise_on_arrays():
    """pd.isna returns an array here; that must not become an exception."""
    assert normalize_null(np.array([1, 2])) is not None


# ----------------------------------------------------------------------
# hashing
# ----------------------------------------------------------------------


def test_file_hash_is_sha256_and_stable(tmp_path):
    path = os.path.join(str(tmp_path), "f.txt")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("abaya")

    digest = compute_file_hash(path)
    assert len(digest) == 64
    assert digest == compute_file_hash(path)


def test_file_hash_changes_with_content(tmp_path):
    path = os.path.join(str(tmp_path), "f.txt")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("a")
    first = compute_file_hash(path)

    with open(path, "w", encoding="utf-8") as handle:
        handle.write("b")
    assert compute_file_hash(path) != first


def test_missing_file_hash_raises():
    with pytest.raises(FileNotFoundError):
        compute_file_hash("/nonexistent/path.csv")


def test_dict_hash_is_deterministic_and_order_independent():
    a = compute_dict_hash({"b": 2, "a": 1, "nested": {"y": 1, "x": 0}})
    b = compute_dict_hash({"a": 1, "nested": {"x": 0, "y": 1}, "b": 2})
    assert a == b
    assert len(a) == 64


def test_dict_hash_distinguishes_content():
    assert compute_dict_hash({"a": 1}) != compute_dict_hash({"a": 2})


# ----------------------------------------------------------------------
# malformed configuration
# ----------------------------------------------------------------------


def test_malformed_yaml_raises_config_error(tmp_path):
    path = os.path.join(str(tmp_path), "bad.yaml")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("ai_synonyms: [unclosed\n")

    with pytest.raises(ConfigError, match="Malformed"):
        Canonicalizer(path)


def test_missing_synonyms_file_raises_config_error():
    with pytest.raises(ConfigError, match="not found"):
        Canonicalizer("/nonexistent/synonyms.yaml")


def test_empty_synonyms_file_is_usable(tmp_path):
    """No synonyms is a valid configuration: everything canonicalizes to itself."""
    path = os.path.join(str(tmp_path), "empty.yaml")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("")

    canonicalizer = Canonicalizer(path)
    assert canonicalizer.canonicalize_ai("Butterfly", "silhouette") == "butterfly"


def test_malformed_manifest_json_raises_config_error(tmp_path):
    from benchmark.integrity_gate import IntegrityGate

    path = os.path.join(str(tmp_path), "manifest.json")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("{not json")

    with pytest.raises(ConfigError, match="Malformed manifest"):
        IntegrityGate(manifest_path=path, gold_path="g.csv", dataset_path="d.csv")


# ----------------------------------------------------------------------
# id normalization
# ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [("P001", "P001"), ("  P001  ", "P001"), ("\tP001\n", "P001"), (None, ""), (float("nan"), "")],
)
def test_id_normalization(raw, expected):
    assert normalize_id(raw) == expected


def test_numeric_ids_do_not_become_floats(tmp_path):
    """An id of 1 must not read back as "1.0" and break set comparison."""
    path = os.path.join(str(tmp_path), "train.csv")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("product_id\n1\n2\n")

    assert load_training_ids(path) == {"1", "2"}


def test_id_named_na_is_not_swallowed(tmp_path):
    """A literal id of "NA" is an id, not a missing value."""
    path = os.path.join(str(tmp_path), "train.csv")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("product_id\nNA\nP002\n")

    assert "NA" in load_training_ids(path)


def test_missing_training_file_yields_empty_set():
    assert load_training_ids("/nonexistent/train.csv") == set()
    assert LeakageDetector.from_csv("/nonexistent/train.csv").is_active is False


# ----------------------------------------------------------------------
# evidence verifier
# ----------------------------------------------------------------------


def test_evidence_supported_when_value_present(validator):
    verifier = validator.evidence_verifier
    assert verifier.verify("butterfly", "silhouette", "a butterfly abaya") == SUPPORTED


def test_evidence_supported_via_alias(validator):
    """"farasha" in the text supports a prediction of "butterfly"."""
    verifier = validator.evidence_verifier
    assert verifier.verify("butterfly", "silhouette", "عباية farasha") == SUPPORTED


def test_evidence_absent_when_text_is_silent(validator):
    verifier = validator.evidence_verifier
    assert verifier.verify("butterfly", "silhouette", "a plain abaya") == ABSENT


def test_evidence_absent_for_empty_text(validator):
    verifier = validator.evidence_verifier
    for text in ("", "   ", None, float("nan")):
        assert verifier.verify("butterfly", "silhouette", text) == ABSENT


def test_evidence_unsupported_when_text_says_something_else(validator):
    verifier = validator.evidence_verifier
    assert verifier.verify("butterfly", "silhouette", "a kimono abaya") == UNSUPPORTED


def test_evidence_partial_for_multiword_value(validator):
    verifier = validator.evidence_verifier
    assert verifier.verify("machine embroidery", "embroidery_type", "fine machine work") == PARTIAL


def test_evidence_for_null_value_is_absent(validator):
    verifier = validator.evidence_verifier
    assert verifier.verify(None, "silhouette", "a butterfly abaya") == ABSENT


# ----------------------------------------------------------------------
# JSON safety
# ----------------------------------------------------------------------


def test_sanitize_converts_nan_to_none():
    payload = {"a": float("nan"), "b": [1, float("nan")], "c": {"d": pd.NA}}
    clean = sanitize_for_json(payload)

    assert clean["a"] is None
    assert clean["b"][1] is None
    assert clean["c"]["d"] is None
    json.dumps(clean, allow_nan=False)


def test_auditor_writes_readable_jsonl(tmp_path):
    auditor = Auditor(os.path.join(str(tmp_path), "run"))
    auditor.log_event("test_event", {"value": float("nan"), "id": "P001"})

    with open(auditor.events_path, "r", encoding="utf-8") as handle:
        rows = [json.loads(line) for line in handle if line.strip()]

    assert rows[0]["kind"] == "test_event"
    assert rows[0]["payload"]["value"] is None


def test_auditor_refuses_to_write_nan(tmp_path):
    """allow_nan=False means a NaN that slipped through fails loudly."""
    auditor = Auditor(os.path.join(str(tmp_path), "run"))
    path = auditor.save_json("ok.json", {"value": float("nan")})

    with open(path, "r", encoding="utf-8") as handle:
        assert json.load(handle)["value"] is None


def test_numpy_scalars_serialize(tmp_path):
    auditor = Auditor(os.path.join(str(tmp_path), "run"))
    path = auditor.save_json("np.json", {"count": np.int64(5), "rate": np.float64(0.5)})

    with open(path, "r", encoding="utf-8") as handle:
        loaded = json.load(handle)
    assert loaded["count"] == 5
    assert loaded["rate"] == 0.5
