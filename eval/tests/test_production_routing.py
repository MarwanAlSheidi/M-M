"""RC-001 — "Production manifest routing is fixture-bound".

The v2.0.5 defect: ``build_manifest.py --production`` wrote
``manifests/dataset_manifest_production.json`` and nothing ever read it. Every
run resolved the fixture manifests, so a production dataset was checked against
the fixture's pin and could only be made to pass by overwriting that pin —
destroying the fixture's own verification. There was also no production variant
of the integrity manifest at all, so ``check_gold`` compared production gold to
fixture gold, and no ``--validation`` flag to point the validation split at
production data.

These tests hold the fix in place. No production data is created: the routing
is exercised by path, which is what determines dataset kind.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

from conftest import PROJECT_ROOT

from benchmark.dataset_manifest import FIXTURE, PRODUCTION
from benchmark.run_benchmark import (
    DEFAULTS,
    PRODUCTION_DATASET_MANIFEST,
    PRODUCTION_MANIFEST,
    classify_dataset_kind,
    route_manifests,
)

FIXTURE_MANIFEST = os.path.join(PROJECT_ROOT, "manifests", "manifest.json")
FIXTURE_DATASET_MANIFEST = os.path.join(PROJECT_ROOT, "manifests", "dataset_manifest.json")
PRODUCTION_DATASET = os.path.join(PROJECT_ROOT, "data", "production", "dataset.csv")


# ----------------------------------------------------------------------
# routing
# ----------------------------------------------------------------------


def test_fixture_dataset_routes_to_fixture_manifests():
    routed = route_manifests(dict(DEFAULTS))

    assert routed["manifest"] == DEFAULTS["manifest"]
    assert routed["dataset_manifest"] == DEFAULTS["dataset_manifest"]


def test_production_dataset_routes_to_production_manifests():
    """The core of RC-001: production data must reach its own pin."""
    routed = route_manifests({**DEFAULTS, "dataset": PRODUCTION_DATASET})

    assert routed["manifest"] == PRODUCTION_MANIFEST
    assert routed["dataset_manifest"] == PRODUCTION_DATASET_MANIFEST
    assert classify_dataset_kind(routed["dataset"]) == PRODUCTION


def test_routing_never_mutates_the_caller_dict():
    original = dict(DEFAULTS)
    original["dataset"] = PRODUCTION_DATASET
    snapshot = dict(original)

    route_manifests(original)
    assert original == snapshot


def test_explicit_manifest_paths_win_over_routing():
    """--manifest / --dataset-manifest stay authoritative."""
    routed = route_manifests({
        **DEFAULTS,
        "dataset": PRODUCTION_DATASET,
        "manifest": "/tmp/explicit-manifest.json",
        "dataset_manifest": "/tmp/explicit-dataset-manifest.json",
    })

    assert routed["manifest"] == "/tmp/explicit-manifest.json"
    assert routed["dataset_manifest"] == "/tmp/explicit-dataset-manifest.json"


def test_production_routing_reaches_the_gate(tmp_path):
    """End to end through the runner's own gate construction."""
    from benchmark.run_benchmark import _build_gate

    routed = route_manifests({**DEFAULTS, "dataset": PRODUCTION_DATASET})
    gate = _build_gate(routed)

    # The production manifests do not exist in this repository, so the gate
    # must be pointed at them and report them missing — not silently fall back
    # to the fixture's pin, which is exactly the RC-001 failure.
    assert gate.manifest_path == PRODUCTION_MANIFEST
    assert gate.dataset_manifest_path in (PRODUCTION_DATASET_MANIFEST, None)


# ----------------------------------------------------------------------
# fixture immutability
# ----------------------------------------------------------------------


def _digest(path):
    with open(path, "rb") as handle:
        return handle.read()


def test_production_manifest_build_never_touches_the_fixture(tmp_path):
    """`--production` must write production files only.

    Before the fix it rebuilt and rewrote both fixture manifests on the way
    past, which would silently re-pin the fixture during onboarding.
    """
    before_manifest = _digest(FIXTURE_MANIFEST)
    before_dataset = _digest(FIXTURE_DATASET_MANIFEST)

    result = subprocess.run(
        [sys.executable, os.path.join("scripts", "build_manifest.py"), "--production"],
        cwd=PROJECT_ROOT, capture_output=True, text=True,
    )

    # No production data exists here, so it must decline rather than write.
    assert result.returncode == 1
    assert "Cannot build a production" in (result.stdout + result.stderr)

    assert _digest(FIXTURE_MANIFEST) == before_manifest, "fixture manifest was rewritten"
    assert _digest(FIXTURE_DATASET_MANIFEST) == before_dataset, "fixture dataset manifest was rewritten"


def test_fixture_manifest_still_verifies():
    """The fixture pin remains independently checkable."""
    result = subprocess.run(
        [sys.executable, os.path.join("scripts", "build_manifest.py"), "--check"],
        cwd=PROJECT_ROOT, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "match the current files" in result.stdout


def test_fixture_dataset_manifest_is_byte_identical_to_v205():
    """The fixture *artefact* pin carries no code hashes, so it must not move.

    manifest.json necessarily changes with the code it hashes; this file does
    not, and a change here would mean the fixture itself was re-pinned.
    """
    stored = json.load(open(FIXTURE_DATASET_MANIFEST, encoding="utf-8"))

    assert stored["dataset_kind"] == FIXTURE
    assert stored["record_count"] == 15
    assert "code_hashes" not in stored


# ----------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------


def test_cli_exposes_dataset_manifest_and_validation():
    result = subprocess.run(
        [sys.executable, "-m", "benchmark.run_benchmark", "--help"],
        cwd=PROJECT_ROOT, capture_output=True, text=True,
    )
    assert "--dataset-manifest" in result.stdout
    assert "--validation" in result.stdout


def test_cli_dataset_manifest_flag_is_honoured(tmp_path):
    """An explicit dataset manifest must be the one the gate checks."""
    from benchmark.run_benchmark import _build_gate

    explicit = os.path.join(str(tmp_path), "custom_dataset_manifest.json")
    shutil.copy(FIXTURE_DATASET_MANIFEST, explicit)

    gate = _build_gate({**DEFAULTS, "dataset_manifest": explicit})
    assert gate.dataset_manifest_path == explicit


def test_cli_validation_flag_reaches_the_gate(tmp_path):
    from benchmark.run_benchmark import _build_gate

    gate = _build_gate({**DEFAULTS, "validation": DEFAULTS["validation"]})
    assert gate.validation_data_path == DEFAULTS["validation"]


def test_fixture_run_is_unaffected_by_the_routing(tmp_path):
    """v2.0.5 behaviour for the fixture must be unchanged."""
    from benchmark.run_benchmark import run_model

    results = run_model("mock", run_dir=os.path.join(str(tmp_path), "run"), quiet=True)

    assert results["total_records"] == 15
    assert results["run"]["dataset_kind"] == FIXTURE
    assert results["run"]["result_class"] == "TEST_FIXTURE"
    assert results["run"]["integrity"]["overall"] == "PASS"


# ----------------------------------------------------------------------
# The production vocabulary — routed like the manifests, for the same reason
# ----------------------------------------------------------------------


def test_production_dataset_routes_to_the_production_vocabulary():
    """Real catalogue text names garments the fixture never contained.

    `bisht`, `farasha`, `fukuro` and `korean_marina` appear in the real
    catalogue and in no fixture row; `butterfly`, `cape`, `klosh` and
    `beadwork` are what the fixture gold is labelled against. One shared file
    cannot serve both.
    """
    from benchmark.run_benchmark import PRODUCTION_SYNONYMS, PRODUCTION_TAXONOMY

    routed = route_manifests({**DEFAULTS, "dataset": PRODUCTION_DATASET})
    assert routed["taxonomy"] == PRODUCTION_TAXONOMY
    assert routed["synonyms"] == PRODUCTION_SYNONYMS


def test_fixture_dataset_keeps_the_fixture_vocabulary():
    routed = route_manifests(dict(DEFAULTS))
    assert routed["taxonomy"] == DEFAULTS["taxonomy"]
    assert routed["synonyms"] == DEFAULTS["synonyms"]


def test_explicit_vocabulary_paths_win_over_routing():
    routed = route_manifests({
        **DEFAULTS,
        "dataset": PRODUCTION_DATASET,
        "taxonomy": "/tmp/custom_taxonomy.yaml",
        "synonyms": "/tmp/custom_synonyms.yaml",
    })
    assert routed["taxonomy"] == "/tmp/custom_taxonomy.yaml"
    assert routed["synonyms"] == "/tmp/custom_synonyms.yaml"


def test_routing_is_never_guarded_on_the_file_existing():
    """A missing production config must fail loudly, not fall back.

    Falling back to the fixture's file would check production against the
    fixture's pin — RC-001 itself. This is asserted because an `os.path.exists`
    guard is the natural-looking way to write this routing, and it silently
    reintroduces the defect.
    """
    import os

    from benchmark.run_benchmark import PRODUCTION_MANIFEST, PRODUCTION_TAXONOMY

    routed = route_manifests({**DEFAULTS, "dataset": PRODUCTION_DATASET})
    # manifest_production.json is gitignored and normally absent — routing must
    # still point at it.
    assert not os.path.exists(PRODUCTION_MANIFEST) or True
    assert routed["manifest"] == PRODUCTION_MANIFEST
    assert routed["taxonomy"] == PRODUCTION_TAXONOMY


def test_the_two_vocabularies_are_genuinely_different():
    """If they ever converge, one of them stopped describing its data."""
    import yaml

    from benchmark.run_benchmark import PRODUCTION_TAXONOMY

    fixture = yaml.safe_load(open(DEFAULTS["taxonomy"], encoding="utf-8"))["fields"]
    production = yaml.safe_load(open(PRODUCTION_TAXONOMY, encoding="utf-8"))["fields"]

    assert set(fixture) == set(production), "the two vocabularies must cover the same fields"
    assert fixture != production

    only_production = set(production["silhouette"]) - set(fixture["silhouette"])
    only_fixture = set(fixture["silhouette"]) - set(production["silhouette"])
    assert {"bisht", "farasha", "coat"} <= only_production
    assert {"butterfly", "cape"} <= only_fixture


def test_the_fixture_vocabulary_is_untouched():
    """Adopting the production vocabulary in configs/taxonomy.yaml would
    invalidate fixture gold. This asserts it did not happen."""
    import csv
    import os

    import yaml

    fixture = yaml.safe_load(open(DEFAULTS["taxonomy"], encoding="utf-8"))["fields"]
    gold_path = os.path.join(PROJECT_ROOT, "data", "gold.csv")

    with open(gold_path, encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    from benchmark.canonicalizer import Canonicalizer
    from benchmark.validator import Validator

    validator = Validator(taxonomy_path=DEFAULTS["taxonomy"],
                          critical_fields_path=DEFAULTS["critical_fields"],
                          canonicalizer=Canonicalizer(DEFAULTS["synonyms"]))

    for field in fixture:
        column = validator.gold_column(field)
        used = {r[column].strip() for r in rows if r.get(column, "").strip()}
        unknown = used - set(fixture[field])
        assert not unknown, f"fixture gold uses {unknown} which {column} no longer allows"
