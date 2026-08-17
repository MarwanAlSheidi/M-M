"""TESTS 38-40: run identification, resume, and refusal to resume on drift."""

from __future__ import annotations

import json
import os

import pytest
from conftest import DATASET_COLUMNS, GOLD_COLUMNS, dataset_row, gold_row, write_csv

from benchmark.exceptions import IntegrityError
from benchmark.run_benchmark import DEFAULTS, build_fingerprint, run_model
from benchmark.run_context import (
    Checkpoint,
    RunFingerprint,
    assert_resumable,
    build_run_id,
    find_latest_run,
)


# ----------------------------------------------------------------------
# TEST 38: run id
# ----------------------------------------------------------------------


def test_38_run_id_has_timestamp_model_and_fingerprint():
    """TEST 38: `<utc>_<model>_<short hash>` — sortable, greppable, distinct."""
    fingerprint = RunFingerprint({"dataset_sha256": "a" * 64, "prompt_sha256": "b" * 64})
    run_id = build_run_id("openai_gpt4o_mini", fingerprint)

    parts = run_id.split("_")
    assert parts[0].endswith("Z")
    assert len(parts[0]) == 16                 # 20260817T070000Z
    assert "openai" in run_id
    assert run_id.endswith(fingerprint.short)
    assert len(fingerprint.short) == 8


def test_38b_run_id_differs_when_configuration_differs():
    a = RunFingerprint({"prompt_sha256": "a" * 64})
    b = RunFingerprint({"prompt_sha256": "b" * 64})
    assert build_run_id("m", a) != build_run_id("m", b)


def test_38c_fingerprint_is_stable_for_identical_configuration():
    values = {"dataset_sha256": "x" * 64, "code_sha256": "y" * 64}
    assert RunFingerprint(dict(values)).digest == RunFingerprint(dict(values)).digest


def test_38d_run_writes_every_documented_artefact(tmp_path):
    run_dir = os.path.join(str(tmp_path), "run")
    results = run_model(model_key="mock", run_dir=run_dir, quiet=True)

    for name in (
        "metadata.json",
        "integrity_report.json",
        "predictions_raw.jsonl",
        "predictions_validated.jsonl",
        "predictions_final.jsonl",
        "evaluation_results.json",
        "cost_summary.json",
        "audit.jsonl",
    ):
        assert os.path.exists(os.path.join(run_dir, name)), name

    assert results["run"]["run_id"]
    assert results["run"]["fingerprint"]["fingerprint_sha256"]


def test_38e_metadata_records_the_full_provenance(tmp_path):
    run_dir = os.path.join(str(tmp_path), "run")
    run_model(model_key="mock", run_dir=run_dir, quiet=True)

    with open(os.path.join(run_dir, "metadata.json"), "r", encoding="utf-8") as handle:
        metadata = json.load(handle)

    for key in (
        "run_id", "model_key", "provider", "temperature", "seed",
        "determinism_supported", "prompt_sha256", "prompt_name", "prompt_version",
        "model_config_sha256", "dataset_kind", "fingerprint",
    ):
        assert key in metadata, key

    fingerprint = metadata["fingerprint"]
    for key in (
        "dataset_sha256", "gold_sha256", "prompt_sha256", "taxonomy_sha256",
        "synonyms_sha256", "critical_fields_sha256", "model_config_sha256",
        "pricing_sha256", "code_sha256",
    ):
        assert fingerprint.get(key), key


def test_find_latest_run_picks_the_newest(tmp_path):
    root = str(tmp_path)
    for name in ("20260101T000000Z_mock_aaaaaaaa", "20260202T000000Z_mock_bbbbbbbb"):
        os.makedirs(os.path.join(root, name))

    latest = find_latest_run(root, "mock")
    assert latest.endswith("20260202T000000Z_mock_bbbbbbbb")


# ----------------------------------------------------------------------
# TEST 39: resume
# ----------------------------------------------------------------------


def test_39_resume_skips_completed_records(tmp_path):
    """TEST 39: a resumed run does not re-call the API for finished records."""
    run_dir = os.path.join(str(tmp_path), "run")

    # First pass: 5 of the 15 fixture records.
    first = run_model(model_key="mock", run_dir=run_dir, max_records=5, quiet=True)
    assert first["total_records"] == 5

    checkpoint = Checkpoint.load(run_dir)
    assert len(checkpoint.completed_ids) == 5

    # Second pass over the full dataset, resuming.
    second = run_model(model_key="mock", run_dir=run_dir, resume=True, quiet=True)

    assert second["total_records"] == 15
    assert second["run"]["resumed_records"] == 5
    assert len(Checkpoint.load(run_dir).completed_ids) == 15


def test_39b_resume_reuses_the_stored_raw_answers(tmp_path):
    """Restored records keep their original raw prediction, not a fresh call."""
    run_dir = os.path.join(str(tmp_path), "run")
    run_model(model_key="mock", run_dir=run_dir, max_records=3, quiet=True)

    raw_path = os.path.join(run_dir, "predictions_raw.jsonl")
    with open(raw_path, "r", encoding="utf-8") as handle:
        original = {json.loads(line)["product_id"]: json.loads(line) for line in handle if line.strip()}

    # Tag the stored answers so a reuse is distinguishable from a re-call.
    for record in original.values():
        record["request_id"] = "RESTORED-MARKER"
    with open(raw_path, "w", encoding="utf-8") as handle:
        for record in original.values():
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    run_model(model_key="mock", run_dir=run_dir, resume=True, quiet=True)

    with open(raw_path, "r", encoding="utf-8") as handle:
        after = [json.loads(line) for line in handle if line.strip()]

    markers = [row for row in after if row.get("request_id") == "RESTORED-MARKER"]
    assert len(markers) == 3, "resumed records were re-classified instead of restored"
    assert len(after) == 15


def test_39c_resume_without_a_checkpoint_is_a_normal_run(tmp_path):
    run_dir = os.path.join(str(tmp_path), "run")
    results = run_model(model_key="mock", run_dir=run_dir, resume=True, quiet=True)

    assert results["total_records"] == 15
    assert results["run"]["resumed_records"] == 0


def test_39d_completed_records_still_pass_leakage_checks(tmp_path):
    """A leaked record must not survive a resume just because it was cheap."""
    from benchmark.exceptions import LeakageError
    from benchmark.leakage_detector import LeakageDetector
    from benchmark.pipeline import Pipeline

    run_dir = os.path.join(str(tmp_path), "run")
    run_model(model_key="mock", run_dir=run_dir, max_records=3, quiet=True)

    # Rebuild a pipeline whose training set now contains a completed record.
    from benchmark.run_benchmark import build_components

    components = build_components(DEFAULTS)
    pipeline = Pipeline(
        run_dir=run_dir,
        validator=components["validator"],
        canonicalizer=components["canonicalizer"],
        prompt_renderer=components["prompt_renderer"],
        classifier=None,
        leakage_detector=LeakageDetector(training_ids=["P001"]),
    )
    pipeline.load_dataset(DEFAULTS["dataset"])
    pipeline.load_gold(DEFAULTS["gold"])
    pipeline.completed_ids = {"P001"}

    with pytest.raises(LeakageError, match="P001"):
        pipeline.run_classification()


# ----------------------------------------------------------------------
# TEST 40: resume hash mismatch
# ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "drifted_key",
    ["dataset_sha256", "gold_sha256", "prompt_sha256", "model_config_sha256", "code_sha256"],
)
def test_40_resume_refuses_on_any_fingerprint_drift(drifted_key):
    """TEST 40: resuming across a configuration change is refused, not merged."""
    stored = {key: "a" * 64 for key in RunFingerprint({}).as_dict() if key != "fingerprint_sha256"}
    checkpoint = Checkpoint(run_id="r", model_key="mock", fingerprint=stored)

    current = RunFingerprint({**stored, drifted_key: "b" * 64})

    with pytest.raises(IntegrityError, match="configuration changed") as raised:
        assert_resumable(checkpoint, current, "mock")

    # The message must name what drifted, so the operator knows what to fix.
    assert drifted_key in str(raised.value)


def test_40b_resume_refuses_a_different_model(tmp_path):
    stored = {key: "a" * 64 for key in RunFingerprint({}).as_dict() if key != "fingerprint_sha256"}
    checkpoint = Checkpoint(run_id="r", model_key="mock", fingerprint=stored)

    with pytest.raises(IntegrityError, match="belongs to model"):
        assert_resumable(checkpoint, RunFingerprint(stored), "mock_variant")


def test_40c_resume_allowed_when_nothing_changed():
    stored = {key: "a" * 64 for key in RunFingerprint({}).as_dict() if key != "fingerprint_sha256"}
    checkpoint = Checkpoint(run_id="r", model_key="mock", fingerprint=stored)

    assert_resumable(checkpoint, RunFingerprint(stored), "mock")  # must not raise


def test_40d_resume_refuses_after_a_real_gold_edit(tmp_path):
    """End to end: edit gold between runs and the resume is blocked."""
    dataset_path = os.path.join(str(tmp_path), "dataset.csv")
    gold_path = os.path.join(str(tmp_path), "gold.csv")
    run_dir = os.path.join(str(tmp_path), "run")

    rows = [dataset_row(f"P00{i}") for i in range(1, 4)]
    write_csv(dataset_path, DATASET_COLUMNS, rows)
    write_csv(gold_path, GOLD_COLUMNS, [gold_row(f"P00{i}") for i in range(1, 4)])

    paths = {**DEFAULTS, "dataset": dataset_path, "gold": gold_path}
    run_model(model_key="mock", paths=paths, run_dir=run_dir, strict=False, quiet=True)

    # Gold changes; the earlier records were scored against the old labels.
    write_csv(
        gold_path,
        GOLD_COLUMNS,
        [gold_row(f"P00{i}", color_normalized="white") for i in range(1, 4)],
    )

    with pytest.raises(IntegrityError, match="configuration changed"):
        run_model(
            model_key="mock", paths=paths, run_dir=run_dir,
            resume=True, strict=False, quiet=True,
        )


def test_fingerprint_covers_every_input_that_could_change_results():
    fingerprint = build_fingerprint(DEFAULTS, "prompt-hash", "model-hash")
    values = fingerprint.values

    assert values["prompt_sha256"] == "prompt-hash"
    assert values["model_config_sha256"] == "model-hash"
    for key in ("dataset_sha256", "gold_sha256", "taxonomy_sha256", "synonyms_sha256",
                "critical_fields_sha256", "pricing_sha256", "code_sha256"):
        assert values[key], key
