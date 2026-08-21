"""Regression tests from the v2.0.5 final release audit.

Each test here corresponds to a defect the audit found in the tagged v2.0.5
tree. They exist so the same class of defect cannot return silently.
"""

from __future__ import annotations

import json
import os

import pytest
from conftest import PROJECT_ROOT

import benchmark
from benchmark.dataset_manifest import FIXTURE, PRODUCTION
from benchmark.reporting import build_report, result_label
from benchmark.run_benchmark import run_batch
from benchmark.version import __version__ as SOURCE_VERSION


# ----------------------------------------------------------------------
# Defect 1: the package declared a stale __version__
# ----------------------------------------------------------------------


def test_every_version_surface_agrees():
    """`benchmark.__version__` reported 2.0.4 while runs reported 2.0.5.

    The version was written out in four places and one fell behind, so an
    installed package advertised a different release than the runs it produced.
    All surfaces now read from benchmark/version.py.
    """
    import benchmark.reporting as reporting
    import benchmark.run_benchmark as runner

    surfaces = {
        "benchmark.__version__": benchmark.__version__,
        "benchmark.version.__version__": SOURCE_VERSION,
        "run_benchmark.VERSION": runner.VERSION,
        "reporting.VERSION": reporting.VERSION,
    }
    assert len(set(surfaces.values())) == 1, f"version drift: {surfaces}"
    assert benchmark.__version__ == "2.0.6"


def test_run_and_report_carry_the_package_version(tmp_path):
    from benchmark.run_benchmark import run_model

    results = run_model("mock", run_dir=os.path.join(str(tmp_path), "run"), quiet=True)
    assert results["run"]["version"] == benchmark.__version__


def test_shipped_manifest_records_the_package_version():
    with open(os.path.join(PROJECT_ROOT, "manifests", "manifest.json"), "r", encoding="utf-8") as h:
        assert json.load(h)["version"] == benchmark.__version__


def test_no_stale_version_literal_remains_in_the_package():
    """Only version.py may hold a version literal."""
    import re

    package = os.path.join(PROJECT_ROOT, "benchmark")
    literal = re.compile(r'["\']2\.0\.[0-9]+["\']')
    offenders = []

    for name in sorted(os.listdir(package)):
        if not name.endswith(".py") or name == "version.py":
            continue
        with open(os.path.join(package, name), "r", encoding="utf-8") as handle:
            for number, line in enumerate(handle, start=1):
                stripped = line.strip()
                # Prose in docstrings and comments may reference old versions.
                if stripped.startswith("#") or literal.search(line) is None:
                    continue
                offenders.append(f"{name}:{number}: {stripped}")

    assert not offenders, "version literals outside version.py: " + "; ".join(offenders)


# ----------------------------------------------------------------------
# Defect 2: run_batch ignored runs_root for the per-model runs
# ----------------------------------------------------------------------


def test_batch_writes_model_runs_under_its_own_runs_root(tmp_path):
    """A batch directed at one location wrote its model runs somewhere else.

    Reports landed under runs_root while the per-model directories went to the
    package default, splitting a single batch across two locations and
    polluting the shared runs directory during tests.
    """
    runs_root = os.path.join(str(tmp_path), "runs")
    batch = run_batch(["mock", "mock_variant"], runs_root=runs_root, quiet=True)

    assert batch["batch_dir"].startswith(runs_root)

    for model_key, result in batch["results"].items():
        run_dir = result["run"]["run_dir"]
        assert run_dir.startswith(runs_root), f"{model_key} escaped runs_root: {run_dir}"
        assert os.path.exists(os.path.join(run_dir, "predictions_final.jsonl"))


def test_batch_run_directories_are_isolated_per_model(tmp_path):
    """No model may write into another model's directory."""
    runs_root = os.path.join(str(tmp_path), "runs")
    batch = run_batch(["mock", "mock_variant"], runs_root=runs_root, quiet=True)

    directories = {k: r["run"]["run_dir"] for k, r in batch["results"].items()}
    assert len(set(directories.values())) == len(directories)

    for model_key, run_dir in directories.items():
        with open(os.path.join(run_dir, "metadata.json"), "r", encoding="utf-8") as handle:
            assert json.load(handle)["model_key"] == model_key


# ----------------------------------------------------------------------
# Defect 3: REAL_BENCHMARK could be claimed by a run that failed integrity
# ----------------------------------------------------------------------


def test_failed_integrity_can_never_claim_a_real_benchmark():
    """Under --no-strict, production data + a live provider was labelled real.

    A run that only completed because the gate was bypassed has verified
    nothing about what it measured, so it cannot be a benchmark of anything.
    """
    passed = result_label(PRODUCTION, ["openai"], integrity_passed=True)
    failed = result_label(PRODUCTION, ["openai"], integrity_passed=False)

    assert passed["result_class"] == "REAL_BENCHMARK"
    assert failed["result_class"] == "TEST_FIXTURE"
    assert "integrity gate did not pass" in failed["reason"]


def test_all_three_conditions_are_required_for_a_real_label():
    assert result_label(PRODUCTION, ["openai"], True)["result_class"] == "REAL_BENCHMARK"
    assert result_label(FIXTURE, ["openai"], True)["result_class"] == "TEST_FIXTURE"
    assert result_label(PRODUCTION, ["local"], True)["result_class"] == "TEST_FIXTURE"
    assert result_label(PRODUCTION, ["openai"], False)["result_class"] == "TEST_FIXTURE"


def test_report_derives_integrity_from_the_runs_it_summarises():
    def run(overall):
        return {
            "run": {"provider": "openai", "integrity": {"overall": overall}},
            "headline": {},
            "levels": {"final": {"field_metrics": {}}},
            "per_record": [],
        }

    clean = build_report({"a": run("PASS")}, dataset_kind=PRODUCTION)
    dirty = build_report({"a": run("PASS"), "b": run("FAIL")}, dataset_kind=PRODUCTION)

    assert clean["result_class"] == "REAL_BENCHMARK"
    assert clean["integrity_passed"] is True
    # One failed run in the batch demotes the whole report.
    assert dirty["result_class"] == "TEST_FIXTURE"
    assert dirty["integrity_passed"] is False


def test_fixture_run_reports_integrity_passed_true(tmp_path):
    from benchmark.run_benchmark import run_model

    results = run_model("mock", run_dir=os.path.join(str(tmp_path), "run"), quiet=True)
    assert results["run"]["result_class"] == "TEST_FIXTURE"
    assert results["run"]["integrity"]["overall"] == "PASS"


# ----------------------------------------------------------------------
# Defect 4: the single-model path never checked enabled / credentials
# ----------------------------------------------------------------------


def test_disabled_model_is_refused_before_any_provider_is_built(tmp_path):
    """`--model <disabled>` fell through to building a provider.

    run_batch skipped disabled models, but run_model did not check at all. On a
    machine with the provider SDK installed, a disabled model carrying a
    placeholder id would have been instantiated and called.
    """
    from benchmark.exceptions import ConfigError
    from benchmark.run_benchmark import run_model

    run_dir = os.path.join(str(tmp_path), "run")

    with pytest.raises(ConfigError, match="disabled"):
        run_model("anthropic_claude", run_dir=run_dir, quiet=True)

    # Nothing may be constructed for a model that must not run.
    assert not os.path.exists(os.path.join(run_dir, "predictions_final.jsonl"))


def test_model_without_credentials_is_refused(no_credentials, tmp_path):
    from benchmark.exceptions import ConfigError
    from benchmark.run_benchmark import run_model

    with pytest.raises(ConfigError, match="OPENAI_API_KEY"):
        run_model("openai_gpt4o_mini", run_dir=os.path.join(str(tmp_path), "run"), quiet=True)


def test_disabled_model_exits_with_the_invalid_selection_code(capsys):
    """A disabled model is an invalid selection (exit 3), not a classifier fault."""
    from benchmark.run_benchmark import main

    assert main(["--model", "anthropic_claude"]) == 3
    assert "CONFIGURATION ERROR" in capsys.readouterr().err


def test_enabled_local_model_still_runs(tmp_path):
    """The guard must not block the models that are supposed to run."""
    from benchmark.run_benchmark import run_model

    results = run_model("mock", run_dir=os.path.join(str(tmp_path), "run"), quiet=True)
    assert results["total_records"] == 15


# ----------------------------------------------------------------------
# Production data contract
# ----------------------------------------------------------------------


def test_production_contract_documents_every_required_element():
    """The contract must be complete before real data can be handed over."""
    path = os.path.join(PROJECT_ROOT, "data", "production", "README.md")
    with open(path, "r", encoding="utf-8") as handle:
        text = handle.read().lower()

    for required in (
        "product_id",
        "product_name_raw",
        "description_raw",
        "utf-8",
        "unique",
        "granularity",
        "missing",
        "manifest",
        "gold",
        "training",
        "validation",
        "privacy",
    ):
        assert required in text, f"production contract does not cover: {required}"


def test_production_directory_holds_no_data():
    production = os.path.join(PROJECT_ROOT, "data", "production")
    assert os.path.isdir(production)
    assert not [n for n in os.listdir(production) if n.endswith((".csv", ".jsonl", ".parquet"))]
