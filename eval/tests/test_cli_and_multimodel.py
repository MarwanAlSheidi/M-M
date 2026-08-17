"""TESTS 53-56: dry run, CLI, multi-model execution, fixture/production separation."""

from __future__ import annotations

import json
import os

import pytest
from conftest import DATASET_COLUMNS, GOLD_COLUMNS, PROJECT_ROOT, dataset_row, gold_row, write_csv

from benchmark.dataset_manifest import FIXTURE, PRODUCTION, SplitRegistry
from benchmark.exceptions import IntegrityError
from benchmark.reporting import FIXTURE_BANNER, result_label
from benchmark.run_benchmark import (
    DEFAULTS,
    classify_dataset_kind,
    dry_run,
    main,
    run_batch,
    run_model,
)


# ----------------------------------------------------------------------
# TEST 53: dry run
# ----------------------------------------------------------------------


def test_53_dry_run_makes_zero_api_calls():
    """TEST 53: everything validates, nothing is called."""
    report = dry_run(["mock", "mock_variant"])

    assert report["dry_run"] is True
    assert report["api_call_count"] == 0
    assert report["integrity"] == "PASS"
    assert report["configuration"] == "PASS"
    assert report["dataset"] == "PASS"
    assert report["gold"] == "PASS"
    assert report["prompt"] == "PASS"
    assert report["model_configuration"] == "PASS"


def test_53b_dry_run_writes_no_predictions(tmp_path):
    """A dry run must leave no run artefacts behind."""
    before = set(os.listdir(DEFAULTS["runs"])) if os.path.isdir(DEFAULTS["runs"]) else set()
    dry_run(["mock"])
    after = set(os.listdir(DEFAULTS["runs"])) if os.path.isdir(DEFAULTS["runs"]) else set()

    assert before == after


def test_53c_dry_run_reports_uncredentialed_models_without_failing(no_credentials):
    report = dry_run(["mock", "openai_gpt4o_mini"])

    assert report["api_call_count"] == 0
    assert report["models"]["mock"]["credentials_available"] is True
    assert report["models"]["openai_gpt4o_mini"]["credentials_available"] is False
    assert report["model_configuration"] == "INCOMPLETE"


def test_53d_dry_run_never_prints_a_key(no_credentials, monkeypatch, capsys):
    """A configured key is used for readiness and never echoed."""
    secret = "sk-dryrun-secret-abcdefghijklmnop"
    monkeypatch.setenv("OPENAI_API_KEY", secret)

    exit_code = main(["--model", "openai_gpt4o_mini", "--dry-run"])
    output = capsys.readouterr()

    assert exit_code == 0
    assert secret not in output.out
    assert secret not in output.err
    assert "READY" in output.out


def test_53e_dry_run_names_the_missing_variable_not_its_value(no_credentials, capsys):
    """When a key is absent, the operator is told which variable to set."""
    main(["--model", "openai_gpt4o_mini", "--dry-run"])
    output = capsys.readouterr().out

    assert "OPENAI_API_KEY" in output
    assert "NOT READY" in output


# ----------------------------------------------------------------------
# TEST 54: CLI
# ----------------------------------------------------------------------


def test_54_cli_single_model(tmp_path, capsys):
    """TEST 54: `--model mock` runs one model and exits 0."""
    run_dir = os.path.join(str(tmp_path), "run")
    exit_code = main(["--model", "mock", "--run-dir", run_dir])

    assert exit_code == 0
    assert os.path.exists(os.path.join(run_dir, "predictions_final.jsonl"))


def test_54b_cli_dry_run_flag(capsys):
    assert main(["--model", "mock", "--dry-run"]) == 0
    assert "DRY RUN" in capsys.readouterr().out


def test_54c_cli_max_records(tmp_path):
    run_dir = os.path.join(str(tmp_path), "run")
    main(["--model", "mock", "--run-dir", run_dir, "--max-records", "4"])

    with open(os.path.join(run_dir, "predictions_final.jsonl"), "r", encoding="utf-8") as handle:
        rows = [line for line in handle if line.strip()]
    assert len(rows) == 4


def test_54d_cli_unknown_model_exits_with_config_error(capsys):
    assert main(["--model", "no_such_model"]) == 3
    assert "CONFIGURATION ERROR" in capsys.readouterr().err


def test_54e_cli_integrity_failure_exits_two(tmp_path, capsys):
    dataset_path = os.path.join(str(tmp_path), "dataset.csv")
    gold_path = os.path.join(str(tmp_path), "gold.csv")
    write_csv(dataset_path, DATASET_COLUMNS, [dataset_row("P001"), dataset_row("P999")])
    write_csv(gold_path, GOLD_COLUMNS, [gold_row("P001")])

    exit_code = main([
        "--model", "mock", "--dataset", dataset_path, "--gold", gold_path,
        "--run-dir", os.path.join(str(tmp_path), "run"),
    ])

    assert exit_code == 2
    assert "INTEGRITY FAILURE" in capsys.readouterr().err


def test_54f_cli_all_models_skips_uncredentialed(no_credentials, tmp_path, capsys):
    exit_code = main(["--all-models"])
    output = capsys.readouterr().out

    assert exit_code == 0
    # The two offline models run; the credentialed ones are absent from the batch.
    assert "mock" in output
    assert "BATCH REPORT" in output


def test_54g_v204_cli_flags_still_work(tmp_path):
    """The v2.0.4 invocation must not have been broken by the new flags."""
    run_dir = os.path.join(str(tmp_path), "run")
    assert main(["--run-dir", run_dir]) == 0
    assert os.path.exists(os.path.join(run_dir, "evaluation_results.json"))


# ----------------------------------------------------------------------
# TEST 55: multi-model fixture execution
# ----------------------------------------------------------------------


def test_55_multi_model_batch_runs_both_offline_models(tmp_path):
    """TEST 55: two models, identical inputs, one comparison document."""
    batch = run_batch(
        ["mock", "mock_variant"],
        runs_root=os.path.join(str(tmp_path), "runs"),
        quiet=True,
    )

    assert set(batch["results"]) == {"mock", "mock_variant"}
    comparison = batch["comparison"]

    assert comparison["identical_record_sets"] is True
    assert len(comparison["rows"]) == 2
    assert len(comparison["paired"]) == 1
    assert comparison["agreement"]["comparable_records"] == 15


def test_55b_every_model_in_a_batch_uses_one_prompt_hash(tmp_path):
    """TEST 36 end to end: models must never be scored under different prompts."""
    batch = run_batch(
        ["mock", "mock_variant"],
        runs_root=os.path.join(str(tmp_path), "runs"),
        quiet=True,
    )

    hashes = {key: result["run"]["prompt_sha256"] for key, result in batch["results"].items()}
    assert len(set(hashes.values())) == 1


def test_55c_models_in_a_batch_have_distinct_config_hashes(tmp_path):
    batch = run_batch(
        ["mock", "mock_variant"],
        runs_root=os.path.join(str(tmp_path), "runs"),
        quiet=True,
    )
    hashes = {key: r["run"]["model_config_sha256"] for key, r in batch["results"].items()}
    assert len(set(hashes.values())) == 2


def test_55d_batch_writes_every_report_artefact(tmp_path):
    batch = run_batch(
        ["mock", "mock_variant"],
        runs_root=os.path.join(str(tmp_path), "runs"),
        review_sample=5,
        quiet=True,
    )

    for name in (
        "benchmark_report.json",
        "benchmark_report.csv",
        "benchmark_report.md",
        "model_comparison.json",
        "model_comparison.csv",
        "dashboard_field_metrics.csv",
        "review_sample.jsonl",
    ):
        assert os.path.exists(os.path.join(batch["batch_dir"], name)), name


def test_55e_review_sample_rows_carry_what_a_reviewer_needs(tmp_path):
    batch = run_batch(
        ["mock", "mock_variant"],
        runs_root=os.path.join(str(tmp_path), "runs"),
        review_sample=5,
        quiet=True,
    )

    path = os.path.join(batch["batch_dir"], "review_sample.jsonl")
    with open(path, "r", encoding="utf-8") as handle:
        rows = [json.loads(line) for line in handle if line.strip()]

    assert 0 < len(rows) <= 5
    for row in rows:
        for key in ("product_id", "source_text", "gold", "model_predictions",
                    "confidence", "evidence", "error_category", "review_reason"):
            assert key in row, key
        assert row["review_reason"]


def test_55f_batch_skips_models_without_credentials(no_credentials, tmp_path):
    batch = run_batch(
        ["mock", "openai_gpt4o_mini"],
        runs_root=os.path.join(str(tmp_path), "runs"),
        quiet=True,
    )

    assert "mock" in batch["results"]
    assert "openai_gpt4o_mini" not in batch["results"]
    assert "OPENAI_API_KEY" in batch["skipped"]["openai_gpt4o_mini"]
    # Skipped models still appear in the report, so nothing vanishes silently.
    assert "openai_gpt4o_mini" in batch["report"]["skipped_models"]


def test_55g_batch_results_are_serializable(tmp_path):
    batch = run_batch(
        ["mock", "mock_variant"],
        runs_root=os.path.join(str(tmp_path), "runs"),
        quiet=True,
    )
    encoded = json.dumps(batch["report"], allow_nan=False, default=str)
    assert "NaN" not in encoded


def test_55h_deterministic_mock_reproduces_identical_metrics(tmp_path):
    """Same inputs, same numbers. Latency is wall-clock and so is excluded."""
    first = run_model("mock", run_dir=os.path.join(str(tmp_path), "a"), quiet=True)
    second = run_model("mock", run_dir=os.path.join(str(tmp_path), "b"), quiet=True)

    assert first["headline"] == second["headline"]
    assert first["levels"] == second["levels"]
    assert first["selective"] == second["selective"]
    assert first["evidence"] == second["evidence"]
    assert first["critical"] == second["critical"]
    assert first["error_analysis"] == second["error_analysis"]
    assert first["confidence_intervals"] == second["confidence_intervals"]
    assert first["run"]["fingerprint"] == second["run"]["fingerprint"]


# ----------------------------------------------------------------------
# TEST 56: fixture / production separation
# ----------------------------------------------------------------------


def test_56_fixture_dataset_is_labelled_as_a_fixture():
    """TEST 56: the shipped dataset is synthetic and says so."""
    assert classify_dataset_kind(DEFAULTS["dataset"]) == FIXTURE


def test_56b_production_directory_is_classified_as_production():
    production_dataset = os.path.join(PROJECT_ROOT, "data", "production", "dataset.csv")
    assert classify_dataset_kind(production_dataset) == PRODUCTION


def test_56c_fixture_results_are_never_labelled_real(tmp_path):
    results = run_model("mock", run_dir=os.path.join(str(tmp_path), "run"), quiet=True)

    assert results["run"]["dataset_kind"] == FIXTURE
    assert results["run"]["result_class"] == "TEST_FIXTURE"


def test_56d_report_banner_warns_on_fixture_results(tmp_path):
    batch = run_batch(
        ["mock", "mock_variant"],
        runs_root=os.path.join(str(tmp_path), "runs"),
        quiet=True,
    )
    report = batch["report"]

    assert report["result_class"] == "TEST_FIXTURE"
    assert report["banner"] == FIXTURE_BANNER
    assert "Do not publish" in report["banner"]

    with open(os.path.join(batch["batch_dir"], "benchmark_report.md"), "r", encoding="utf-8") as h:
        markdown = h.read()
    assert "TEST_FIXTURE" in markdown
    assert "Do not publish" in markdown


def test_56e_every_csv_row_carries_the_fixture_label(tmp_path):
    """A CSV gets filtered and pasted into decks; a header banner would not survive."""
    import csv

    batch = run_batch(
        ["mock", "mock_variant"],
        runs_root=os.path.join(str(tmp_path), "runs"),
        quiet=True,
    )
    with open(os.path.join(batch["batch_dir"], "benchmark_report.csv"), "r", encoding="utf-8") as h:
        rows = list(csv.DictReader(h))

    assert rows
    assert all(row["result_class"] == "TEST_FIXTURE" for row in rows)


def test_56f_real_label_requires_production_data_and_a_live_provider():
    """Both halves are needed. Either alone is still a fixture result."""
    assert result_label(PRODUCTION, ["openai"])["result_class"] == "REAL_BENCHMARK"
    assert result_label(FIXTURE, ["openai"])["result_class"] == "TEST_FIXTURE"
    assert result_label(PRODUCTION, ["local"])["result_class"] == "TEST_FIXTURE"
    assert result_label(FIXTURE, ["local"])["result_class"] == "TEST_FIXTURE"


def test_56g_fixture_dataset_is_not_deleted():
    """The v2.0.4 fixture must remain: the tests depend on it."""
    assert os.path.exists(DEFAULTS["dataset"])
    assert os.path.exists(DEFAULTS["gold"])


# ----------------------------------------------------------------------
# split validation (§8)
# ----------------------------------------------------------------------


def test_split_registry_flags_training_in_evaluation():
    splits = SplitRegistry(training=["P1", "T1"], validation=["V1"], evaluation=["P1", "P2"])

    assert splits.fatal_overlaps()["training_evaluation"] == ["P1"]
    with pytest.raises(IntegrityError, match="Split contamination"):
        splits.assert_clean()


def test_split_registry_flags_validation_in_evaluation():
    splits = SplitRegistry(training=["T1"], validation=["P2"], evaluation=["P1", "P2"])

    assert splits.fatal_overlaps()["validation_evaluation"] == ["P2"]
    with pytest.raises(IntegrityError):
        splits.assert_clean()


def test_split_registry_permits_training_validation_overlap():
    """Tuning on validation is the point of having one; it is not contamination."""
    splits = SplitRegistry(training=["A"], validation=["A"], evaluation=["B"])

    assert splits.overlaps()["training_validation"] == ["A"]
    assert splits.fatal_overlaps() == {}
    splits.assert_clean()


def test_shipped_splits_are_clean():
    splits = SplitRegistry.from_paths(
        training_path=DEFAULTS["training"],
        validation_path=DEFAULTS["validation"],
        evaluation_path=DEFAULTS["dataset"],
    )
    splits.assert_clean()
    assert splits.summary()["clean"] is True


def test_gate_fails_on_split_contamination(gate_builder):
    gate = gate_builder.build(dataset_ids=["P001", "P002"], gold_ids=["P001", "P002"])
    gate.validation_data_path = gate_builder.dataset_path  # validation == evaluation

    check = gate.check_splits()
    assert check["status"] == "FAIL"
    assert any("validation_evaluation" in detail for detail in check["details"])
