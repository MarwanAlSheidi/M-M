"""Integration: the whole benchmark, against the repository's own configuration."""

from __future__ import annotations

import json
import os

import pytest
from conftest import DATASET_COLUMNS, GOLD_COLUMNS, PROJECT_ROOT, dataset_row, gold_row, write_csv

from benchmark.exceptions import IntegrityError
from benchmark.run_benchmark import DEFAULTS, run


@pytest.fixture
def run_dir(tmp_path):
    return os.path.join(str(tmp_path), "run")


def test_end_to_end_smoke_run(run_dir):
    """The shipped dataset, gold, configs and manifest produce a full result."""
    results = run(run_dir=run_dir, strict=True)

    assert results["total_records"] == 15
    assert results["run"]["integrity"]["overall"] == "PASS"
    # Changed from "2.0.4" by the v2.0.5 release. This is the only assertion in
    # the v2.0.4 suite that v2.0.5 alters, and it changed because the version
    # was deliberately bumped — not because behaviour moved under it.
    assert results["run"]["version"] == "2.0.5"

    # Every metric block is present and populated.
    for block in ("levels", "selective", "evidence", "critical", "cost", "headline"):
        assert block in results
    assert set(results["levels"]) == {"raw", "validated", "canonical", "final"}

    headline = results["headline"]
    assert 0.0 < headline["macro_accuracy"] <= 1.0
    assert 0.0 <= headline["abstention_rate"] <= 1.0
    assert 0.0 <= headline["critical_field_error_rate"] <= 1.0


def test_end_to_end_writes_all_three_jsonl_artefacts(run_dir):
    run(run_dir=run_dir, strict=True)

    for name in ("predictions_raw.jsonl", "predictions_validated.jsonl", "predictions_final.jsonl"):
        path = os.path.join(run_dir, name)
        assert os.path.exists(path), name

        with open(path, "r", encoding="utf-8") as handle:
            rows = [json.loads(line) for line in handle if line.strip()]
        assert len(rows) == 15, name
        assert all(row.get("product_id") for row in rows), name


def test_end_to_end_results_are_serializable(run_dir):
    """The result document must round-trip through strict JSON."""
    results = run(run_dir=run_dir, strict=True)

    encoded = json.dumps(results, ensure_ascii=False, allow_nan=False, default=str)
    assert "NaN" not in encoded
    decoded = json.loads(encoded)
    assert decoded["total_records"] == 15

    saved = os.path.join(run_dir, "evaluation_results.json")
    with open(saved, "r", encoding="utf-8") as handle:
        json.load(handle)


def test_end_to_end_cost_is_connected_to_evaluation(run_dir):
    results = run(run_dir=run_dir, strict=True)
    cost = results["cost"]

    assert cost["records"] == results["total_records"]
    assert cost["total_tokens"] > 0
    assert cost["records_critical_exact_match"] == (
        results["levels"]["final"]["critical_exact_match_count"]
    )


def test_integrity_failure_blocks_the_run(tmp_path, run_dir):
    """A dataset/gold mismatch must stop execution, not merely be reported."""
    dataset_path = os.path.join(str(tmp_path), "dataset.csv")
    gold_path = os.path.join(str(tmp_path), "gold.csv")

    write_csv(dataset_path, DATASET_COLUMNS, [dataset_row("P001"), dataset_row("P999")])
    write_csv(gold_path, GOLD_COLUMNS, [gold_row("P001")])

    paths = {**DEFAULTS, "dataset": dataset_path, "gold": gold_path}

    with pytest.raises(IntegrityError, match="blocked"):
        run(paths=paths, run_dir=run_dir, strict=True)

    # No predictions may be written when the gate blocks the run.
    assert not os.path.exists(os.path.join(run_dir, "predictions_final.jsonl"))


def test_integrity_report_is_always_written_even_on_failure(tmp_path, run_dir):
    dataset_path = os.path.join(str(tmp_path), "dataset.csv")
    gold_path = os.path.join(str(tmp_path), "gold.csv")
    write_csv(dataset_path, DATASET_COLUMNS, [dataset_row("P001"), dataset_row("P999")])
    write_csv(gold_path, GOLD_COLUMNS, [gold_row("P001")])

    with pytest.raises(IntegrityError):
        run(paths={**DEFAULTS, "dataset": dataset_path, "gold": gold_path}, run_dir=run_dir)

    report_path = os.path.join(run_dir, "integrity_report.json")
    assert os.path.exists(report_path)

    with open(report_path, "r", encoding="utf-8") as handle:
        report = json.load(handle)
    assert report["overall"] == "FAIL"


def test_run_is_deterministic(tmp_path):
    """Two runs of the same inputs must produce identical numbers."""
    first = run(run_dir=os.path.join(str(tmp_path), "a"), strict=True)
    second = run(run_dir=os.path.join(str(tmp_path), "b"), strict=True)

    assert first["headline"] == second["headline"]
    assert first["levels"]["final"]["field_metrics"] == second["levels"]["final"]["field_metrics"]


def test_manifest_matches_the_shipped_files():
    """The committed manifest must describe the committed files."""
    import subprocess
    import sys

    result = subprocess.run(
        [sys.executable, os.path.join("scripts", "build_manifest.py"), "--check"],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
