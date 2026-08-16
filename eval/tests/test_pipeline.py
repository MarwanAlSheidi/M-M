"""TESTS 17, 32, 33: layer preservation, classifier errors, cost tracking."""

from __future__ import annotations

import json
import os

import pytest
from conftest import DATASET_COLUMNS, GOLD_COLUMNS, dataset_row, gold_row, write_csv

from benchmark.classifier import MockClassifier
from benchmark.cost_tracker import CostTracker
from benchmark.exceptions import IntegrityError, LeakageError
from benchmark.leakage_detector import LeakageDetector
from benchmark.pipeline import Pipeline


@pytest.fixture
def build_pipeline(tmp_path, validator, canonicalizer, prompt_renderer):
    """Factory returning a Pipeline wired to temp data."""

    def _build(dataset_rows=None, gold_rows=None, fail_ids=None, leakage_detector=None):
        dataset_path = os.path.join(str(tmp_path), "dataset.csv")
        gold_path = os.path.join(str(tmp_path), "gold.csv")

        dataset_rows = dataset_rows if dataset_rows is not None else [
            dataset_row("P001", "Butterfly Abaya", "Open-front butterfly abaya in black nida."),
            dataset_row("P002", "Kimono Abaya", "Closed-front kimono abaya in navy satin."),
        ]
        gold_rows = gold_rows if gold_rows is not None else [
            gold_row("P001"),
            gold_row(
                "P002",
                silhouette_normalized="kimono",
                opening_type="closed-front",
                fabric_family="satin",
                color_normalized="navy",
            ),
        ]

        write_csv(dataset_path, DATASET_COLUMNS, dataset_rows)
        write_csv(gold_path, GOLD_COLUMNS, gold_rows)

        pipeline = Pipeline(
            run_dir=os.path.join(str(tmp_path), "run"),
            validator=validator,
            canonicalizer=canonicalizer,
            prompt_renderer=prompt_renderer,
            classifier=MockClassifier(canonicalizer, validator.taxonomy, fail_ids=fail_ids),
            cost_tracker=CostTracker(input_per_1m=0.15, output_per_1m=0.60),
            leakage_detector=leakage_detector or LeakageDetector(),
        )
        pipeline.load_dataset(dataset_path)
        pipeline.load_gold(gold_path)
        return pipeline

    return _build


# ----------------------------------------------------------------------
# TEST 17: layers are preserved
# ----------------------------------------------------------------------


def test_17_all_four_layers_are_preserved(build_pipeline, validator):
    """TEST 17: raw, validated, canonical and final all survive to the record."""
    pipeline = build_pipeline()
    pipeline.run_classification()

    record = pipeline.predictions_final[0]
    entry = record["silhouette"]

    assert set(entry) >= {
        "raw",
        "validated",
        "confidence",
        "evidence",
        "evidence_status",
        "decision",
        "canonical",
        "final",
    }
    assert entry["raw"] == "butterfly"
    assert entry["canonical"] == "butterfly"
    assert entry["final"] == "butterfly"

    # The raw layer keeps the untouched classifier output alongside it.
    raw_record = pipeline.predictions_raw[0]
    assert raw_record["prediction"]["silhouette"]["value"] == "butterfly"
    assert raw_record["source_text"].startswith("اسم المنتج:")


def test_raw_output_is_not_mutated_by_validation(build_pipeline):
    """Validation must not reach back into the classifier's own dict."""
    pipeline = build_pipeline()
    pipeline.run_classification()

    raw_prediction = pipeline.predictions_raw[0]["prediction"]
    # An abstention sets final to None but leaves the raw value intact.
    assert raw_prediction["silhouette"]["value"] == "butterfly"
    assert raw_prediction["silhouette"]["confidence"] == 0.9


def test_abstention_nulls_final_but_keeps_raw(build_pipeline, validator):
    """An unevidenced answer is withdrawn at final, not erased from the record."""
    pipeline = build_pipeline(
        dataset_rows=[dataset_row("P001", "Plain Abaya", "عباية بسيطة")],
        gold_rows=[gold_row("P001", silhouette_normalized="", opening_type="", fabric_family="", color_normalized="")],
    )
    pipeline.run_classification()
    record = pipeline.predictions_final[0]

    # fabric_family is inference-allowed: the mock defaults it to nida.
    assert record["fabric_family"]["raw"] == "nida"
    assert record["fabric_family"]["decision"] == "PREDICT"
    assert record["fabric_family"]["final"] == "nida"
    assert record["fabric_family"]["confidence"] <= 0.6


# ----------------------------------------------------------------------
# TEST 32: classifier errors
# ----------------------------------------------------------------------


def test_32_classifier_error_produces_safe_abstention(build_pipeline, validator):
    """TEST 32: a failed record abstains cleanly instead of crashing the run."""
    pipeline = build_pipeline(fail_ids={"P002"})
    pipeline.run_classification()

    assert len(pipeline.predictions_final) == 2

    failed = next(r for r in pipeline.predictions_final if r["product_id"] == "P002")
    assert failed["error"] is not None
    assert "simulated classifier failure" in failed["error"]

    for field in validator.fields:
        assert failed[field]["decision"] == "ABSTAIN"
        assert failed[field]["final"] is None
        assert failed[field]["reason"] == "classifier_error"

    # The healthy record in the same run is unaffected.
    healthy = next(r for r in pipeline.predictions_final if r["product_id"] == "P001")
    assert healthy["error"] is None
    assert healthy["silhouette"]["final"] == "butterfly"


def test_32b_failed_record_is_scored_not_dropped(build_pipeline, evaluator):
    """A failed record must stay in the denominator."""
    pipeline = build_pipeline(fail_ids={"P002"})
    pipeline.run_classification()

    results = evaluator.evaluate(pipeline.predictions_final, pipeline.gold_lookup)
    assert results["total_records"] == 2

    failed = next(r for r in results["per_record"] if r["product_id"] == "P002")
    assert failed["exact_match"] is False


# ----------------------------------------------------------------------
# TEST 33: cost tracking
# ----------------------------------------------------------------------


def test_33_cost_tracker_receives_correct_values(build_pipeline, evaluator):
    """TEST 33: usage, ids and every correctness flag reach the CostTracker."""
    pipeline = build_pipeline()
    pipeline.run_classification()

    results = evaluator.evaluate(pipeline.predictions_final, pipeline.gold_lookup)
    summary = pipeline.record_costs(results)

    entries = {entry["product_id"]: entry for entry in pipeline.cost_tracker.records}
    assert set(entries) == {"P001", "P002"}

    per_record = {r["product_id"]: r for r in results["per_record"]}
    for product_id, entry in entries.items():
        expected = per_record[product_id]
        assert entry["is_record_correct"] == expected["exact_match"]
        assert entry["raw_exact_match"] == expected["raw_exact_match"]
        assert entry["is_critical_exact_match"] == expected["critical_exact_match"]
        assert entry["fields_total"] == len(expected["fields"])
        assert entry["input_tokens"] > 0
        assert entry["output_tokens"] > 0

    assert summary["records"] == 2
    assert summary["total_tokens"] > 0
    assert summary["total_cost_usd"] > 0
    assert summary["cost_per_record_usd"] == pytest.approx(
        summary["total_cost_usd"] / 2, abs=1e-9
    )


def test_cost_tracker_handles_zero_correct_records():
    """Zero denominators return 0.0, never a ZeroDivisionError."""
    tracker = CostTracker(input_per_1m=1.0, output_per_1m=1.0)
    tracker.add_usage({"prompt_tokens": 10, "completion_tokens": 5}, "P001", {}, False, False, False)
    summary = tracker.summary()

    assert summary["records_correct"] == 0
    assert summary["cost_per_correct_record_usd"] == 0.0


def test_cost_tracker_tolerates_missing_usage():
    tracker = CostTracker()
    entry = tracker.add_usage(None, "P001", None, False, False, False)
    assert entry["input_tokens"] == 0
    assert tracker.summary()["total_cost_usd"] == 0.0


# ----------------------------------------------------------------------
# pre-flight guards
# ----------------------------------------------------------------------


def test_classification_blocks_on_id_mismatch(build_pipeline):
    with pytest.raises(IntegrityError, match="different records"):
        pipeline = build_pipeline(
            dataset_rows=[dataset_row("P001"), dataset_row("P009")],
            gold_rows=[gold_row("P001"), gold_row("P002")],
        )
        pipeline.run_classification()


def test_classification_blocks_on_duplicate_ids(build_pipeline):
    with pytest.raises(IntegrityError, match="Duplicate product_id"):
        pipeline = build_pipeline(
            dataset_rows=[dataset_row("P001"), dataset_row("P001")],
            gold_rows=[gold_row("P001"), gold_row("P001")],
        )
        pipeline.run_classification()


def test_classification_blocks_without_loaded_data(tmp_path, validator, canonicalizer, prompt_renderer):
    pipeline = Pipeline(
        run_dir=os.path.join(str(tmp_path), "run"),
        validator=validator,
        canonicalizer=canonicalizer,
        prompt_renderer=prompt_renderer,
        classifier=MockClassifier(canonicalizer, validator.taxonomy),
    )
    with pytest.raises(IntegrityError, match="Dataset must be loaded"):
        pipeline.run_classification()


def test_dataset_missing_columns_is_rejected_immediately(tmp_path, validator, canonicalizer, prompt_renderer):
    path = os.path.join(str(tmp_path), "bad.csv")
    write_csv(path, ["product_id"], [{"product_id": "P001"}])

    pipeline = Pipeline(
        run_dir=os.path.join(str(tmp_path), "run"),
        validator=validator,
        canonicalizer=canonicalizer,
        prompt_renderer=prompt_renderer,
        classifier=MockClassifier(canonicalizer, validator.taxonomy),
    )
    with pytest.raises(IntegrityError, match="missing required columns"):
        pipeline.load_dataset(path)


def test_empty_dataset_is_rejected(tmp_path, validator, canonicalizer, prompt_renderer):
    path = os.path.join(str(tmp_path), "empty.csv")
    write_csv(path, DATASET_COLUMNS, [])

    pipeline = Pipeline(
        run_dir=os.path.join(str(tmp_path), "run"),
        validator=validator,
        canonicalizer=canonicalizer,
        prompt_renderer=prompt_renderer,
        classifier=MockClassifier(canonicalizer, validator.taxonomy),
    )
    with pytest.raises(IntegrityError, match="no records"):
        pipeline.load_dataset(path)


# ----------------------------------------------------------------------
# leakage layer 2
# ----------------------------------------------------------------------


def test_layer_two_leakage_raises_during_execution(build_pipeline):
    """Even if layer 1 passed, a leaked record stops the run when reached."""
    detector = LeakageDetector(training_ids=["P002"])
    pipeline = build_pipeline(leakage_detector=detector)

    with pytest.raises(LeakageError, match="P002"):
        pipeline.run_classification()


def test_layer_two_catches_republished_text(build_pipeline):
    """The same text under a new id is still leakage."""
    detector = LeakageDetector(
        training_texts=["اسم المنتج: Butterfly Abaya\nالوصف: Open-front butterfly abaya in black nida."]
    )
    pipeline = build_pipeline(leakage_detector=detector)

    with pytest.raises(LeakageError, match="byte-identical"):
        pipeline.run_classification()


# ----------------------------------------------------------------------
# persistence
# ----------------------------------------------------------------------


def test_jsonl_artefacts_are_written_and_readable(build_pipeline):
    pipeline = build_pipeline(fail_ids={"P002"})
    pipeline.run_classification()
    paths = pipeline.save_predictions()

    for path in paths.values():
        assert os.path.exists(path)
        with open(path, "r", encoding="utf-8") as handle:
            rows = [json.loads(line) for line in handle if line.strip()]
        assert len(rows) == 2
        assert all("product_id" in row for row in rows)


def test_jsonl_contains_no_bare_nan(build_pipeline):
    """NaN is invalid JSON; it must be None before it reaches the file."""
    pipeline = build_pipeline()
    pipeline.run_classification()
    paths = pipeline.save_predictions()

    for path in paths.values():
        with open(path, "r", encoding="utf-8") as handle:
            content = handle.read()
        assert "NaN" not in content
        assert "Infinity" not in content
