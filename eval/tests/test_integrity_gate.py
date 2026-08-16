"""TESTS 1-7 and 27-31: alignment, duplicates, leakage, and hash integrity."""

from __future__ import annotations

import os

from conftest import GOLD_COLUMNS, check_named, gold_row, write_csv

from benchmark.integrity_gate import FAIL, PASS


# ----------------------------------------------------------------------
# TEST 1-5: dataset / gold alignment
# ----------------------------------------------------------------------


def test_01_identical_ids_pass(gate_builder):
    """TEST 1: dataset and gold have identical IDs -> PASS."""
    gate = gate_builder.build(
        dataset_ids=["P001", "P002", "P003"], gold_ids=["P001", "P002", "P003"]
    )
    check = gate.check_dataset_gold_alignment()

    assert check["status"] == PASS
    assert "identical record sets" in check["message"]


def test_02_dataset_missing_one_id_fails(gate_builder):
    """TEST 2: dataset missing one ID -> FAIL, and the ID is named."""
    gate = gate_builder.build(
        dataset_ids=["P001", "P002"], gold_ids=["P001", "P002", "P003"]
    )
    check = gate.check_dataset_gold_alignment()

    assert check["status"] == FAIL
    assert any("in gold but not dataset" in detail for detail in check["details"])
    assert any("P003" in detail for detail in check["details"])


def test_03_gold_missing_one_id_fails(gate_builder):
    """TEST 3: gold missing one ID -> FAIL, and the ID is named."""
    gate = gate_builder.build(
        dataset_ids=["P001", "P002", "P003"], gold_ids=["P001", "P002"]
    )
    check = gate.check_dataset_gold_alignment()

    assert check["status"] == FAIL
    assert any("in dataset but not gold" in detail for detail in check["details"])
    assert any("P003" in detail for detail in check["details"])


def test_04_dataset_duplicate_id_fails(gate_builder):
    """TEST 4: duplicate dataset ID -> FAIL."""
    gate = gate_builder.build(
        dataset_ids=["P001", "P002", "P002"], gold_ids=["P001", "P002"]
    )
    check = gate.check_dataset_gold_alignment()

    assert check["status"] == FAIL
    assert any("duplicate dataset ids" in detail for detail in check["details"])


def test_05_gold_duplicate_id_fails(gate_builder):
    """TEST 5: duplicate gold ID -> FAIL."""
    gate = gate_builder.build(
        dataset_ids=["P001", "P002"], gold_ids=["P001", "P002", "P002"]
    )
    check = gate.check_dataset_gold_alignment()

    assert check["status"] == FAIL
    assert any("duplicate gold ids" in detail for detail in check["details"])


def test_alignment_ignores_surrounding_whitespace(gate_builder):
    """IDs differing only by whitespace are the same ID, not a mismatch."""
    gate = gate_builder.build(dataset_ids=[" P001", "P002 "], gold_ids=["P001", "P002"])
    assert gate.check_dataset_gold_alignment()["status"] == PASS


def test_alignment_fails_on_empty_id(gate_builder):
    """An empty product_id is corruption, not a record."""
    gate = gate_builder.build(dataset_ids=["P001", ""], gold_ids=["P001", "P002"])
    check = gate.check_dataset_gold_alignment()

    assert check["status"] == FAIL
    assert any("empty product_id" in detail for detail in check["details"])


# ----------------------------------------------------------------------
# TEST 6-7: leakage
# ----------------------------------------------------------------------


def test_06_training_overlaps_gold_fails(gate_builder):
    """TEST 6: training overlaps gold -> FAIL."""
    gate = gate_builder.build(
        dataset_ids=["P001", "P002"],
        gold_ids=["P001", "P002"],
        training_ids=["P002", "T001"],
    )
    check = gate.check_leakage()

    assert check["status"] == FAIL
    assert any("training ∩ gold" in detail for detail in check["details"])
    assert any("P002" in detail for detail in check["details"])


def test_07_training_overlaps_dataset_fails(gate_builder):
    """TEST 7: training overlaps dataset -> FAIL."""
    gate = gate_builder.build(
        dataset_ids=["P001", "P002"],
        gold_ids=["P001", "P002"],
        training_ids=["P001"],
    )
    check = gate.check_leakage()

    assert check["status"] == FAIL
    assert any("training ∩ dataset" in detail for detail in check["details"])


def test_missing_training_file_warns_not_fails(gate_builder):
    """A missing training file is a WARN: unknown is not the same as clean."""
    gate = gate_builder.build(write_training=False)
    gate.training_data_path = os.path.join(gate_builder.root, "data", "absent.csv")

    check = gate.check_leakage()
    assert check["status"] == "WARN"


def test_clean_training_passes(gate_builder):
    gate = gate_builder.build(
        dataset_ids=["P001"], gold_ids=["P001"], training_ids=["T001", "T002"]
    )
    assert gate.check_leakage()["status"] == PASS


# ----------------------------------------------------------------------
# TEST 27-31: hash integrity
# ----------------------------------------------------------------------


def test_27_gold_hash_mismatch_fails(gate_builder):
    """TEST 27: gold hash mismatch -> FAIL."""
    gate = gate_builder.build(manifest_overrides={"gold_sha256": "0" * 64})
    check = gate.check_gold()

    assert check["status"] == FAIL
    assert "hash mismatch" in check["message"]


def test_27b_gold_edited_after_manifest_fails(gate_builder):
    """Editing gold after the manifest was built must be caught."""
    gate = gate_builder.build(dataset_ids=["P001"], gold_ids=["P001"])
    assert gate.check_gold()["status"] == PASS

    write_csv(gate_builder.gold_path, GOLD_COLUMNS, [gold_row("P001", color_normalized="white")])
    gate.checks = []
    assert gate.check_gold()["status"] == FAIL


def test_28_taxonomy_hash_mismatch_fails(gate_builder):
    """TEST 28: taxonomy hash mismatch -> FAIL."""
    gate = gate_builder.build(manifest_overrides={"taxonomy_sha256": "1" * 64})
    assert gate.check_taxonomy()["status"] == FAIL


def test_28b_synonyms_and_critical_fields_hash_mismatch_fails(gate_builder):
    gate = gate_builder.build(
        manifest_overrides={
            "synonyms_sha256": "2" * 64,
            "critical_fields_sha256": "3" * 64,
        }
    )
    assert gate.check_synonyms()["status"] == FAIL
    assert gate.check_critical_fields()["status"] == FAIL


def test_29_prompt_hash_mismatch_fails(gate_builder, prompt_renderer):
    """TEST 29: prompt hash mismatch -> FAIL."""
    gate = gate_builder.build(manifest_overrides={"prompt_sha256": "4" * 64})
    assert gate.check_prompt(prompt_renderer.prompt_hash)["status"] == FAIL


def test_29b_prompt_hash_match_passes(gate_builder, prompt_renderer):
    gate = gate_builder.build(prompt_hash=prompt_renderer.prompt_hash)
    assert gate.check_prompt(prompt_renderer.prompt_hash)["status"] == PASS


def test_30_model_config_hash_mismatch_fails(gate_builder):
    """TEST 30: model config hash mismatch -> FAIL, for dict and path alike."""
    from conftest import MODEL_CONFIG_PATH

    gate = gate_builder.build(manifest_overrides={"model_config_sha256": "5" * 64})
    assert gate.check_model_config(MODEL_CONFIG_PATH)["status"] == FAIL
    assert gate.check_model_config({"model": "gpt-4o-mini"})["status"] == FAIL


def test_30b_model_config_dict_hash_is_order_independent(gate_builder):
    """Deterministic serialization: key order must not change the hash."""
    from benchmark.utils import compute_dict_hash

    first = compute_dict_hash({"model": "x", "temperature": 0.0})
    second = compute_dict_hash({"temperature": 0.0, "model": "x"})
    assert first == second

    gate = gate_builder.build(manifest_overrides={"model_config_sha256": first})
    assert gate.check_model_config({"temperature": 0.0, "model": "x"})["status"] == PASS


def test_31_code_hash_mismatch_fails(gate_builder):
    """TEST 31: code hash mismatch -> FAIL."""
    gate = gate_builder.build(
        manifest_overrides={"code_hashes": {"evaluator.py": "6" * 64}}
    )
    check = gate.check_code_hashes()

    assert check["status"] == FAIL
    assert any("evaluator.py" in detail for detail in check["details"])


def test_31b_missing_code_hash_warns(gate_builder):
    """A module the manifest does not pin is a WARN, not a FAIL."""
    gate = gate_builder.build(manifest_overrides={"code_hashes": {}})
    check = gate.check_code_hashes()

    assert check["status"] == "WARN"
    assert any("no manifest hash" in detail for detail in check["details"])


# ----------------------------------------------------------------------
# overall verdict
# ----------------------------------------------------------------------


def test_run_returns_pass_when_everything_verifies(gate_builder, prompt_renderer):
    gate = gate_builder.build(prompt_hash=prompt_renderer.prompt_hash)
    result = gate.run(prompt_hash=prompt_renderer.prompt_hash, model_config=None)

    assert result["overall"] == PASS
    assert result["failed_count"] == 0
    assert result["passed_count"] >= 10
    assert set(result) == {
        "overall",
        "checks",
        "passed_count",
        "failed_count",
        "warning_count",
        "summary",
    }


def test_run_is_fail_when_any_single_check_fails(gate_builder, prompt_renderer):
    """One FAIL anywhere makes the whole gate FAIL."""
    gate = gate_builder.build(
        dataset_ids=["P001", "P002"],
        gold_ids=["P001"],
        prompt_hash=prompt_renderer.prompt_hash,
    )
    result = gate.run(prompt_hash=prompt_renderer.prompt_hash, model_config=None)

    assert result["overall"] == FAIL
    assert result["failed_count"] >= 1
    assert "dataset_gold_alignment" in result["summary"]
    assert check_named(result, "dataset_gold_alignment")["status"] == FAIL


def test_evidence_verification_required_and_available(gate_builder):
    gate = gate_builder.build()
    assert gate.check_evidence_verification()["status"] == PASS


def test_missing_manifest_is_a_failure(gate_builder, tmp_path):
    gate = gate_builder.build()
    gate.manifest = {}
    result = gate.run()

    assert result["overall"] == FAIL
    assert check_named(result, "manifest")["status"] == FAIL
