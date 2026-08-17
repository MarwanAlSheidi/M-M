"""Security (§28) and dataset versioning (§6): no secrets on disk, immutable inputs."""

from __future__ import annotations

import json
import os

from conftest import PROJECT_ROOT

from benchmark.auditor import Auditor
from benchmark.dataset_manifest import (
    FIXTURE,
    build_dataset_manifest,
    product_id_hash,
    read_ids,
    verify_dataset_manifest,
)
from benchmark.redaction import Redactor
from benchmark.run_benchmark import DEFAULTS, run_model

SECRET = "sk-audit-leak-test-abcdefghijklmnopqrst"

# A credential that matches NO shape pattern. Mutation testing showed every
# other secret in the suite was `sk-`-prefixed, so the pattern layer alone
# satisfied the assertions and the known-value layer was never exercised.
# Providers do issue opaque tokens, which is the whole reason that layer exists.
OPAQUE_SECRET = "Zx9Qr7Lm2Kd4Nv8Tb6Wy3Hs5Jf1Gp0Ac"


# ----------------------------------------------------------------------
# §28: secrets never reach disk
# ----------------------------------------------------------------------


def test_auditor_redacts_secrets_from_events(tmp_path):
    redactor = Redactor([SECRET])
    auditor = Auditor(os.path.join(str(tmp_path), "run"), redactor=redactor)

    auditor.log_event("provider_error", {"error": f"auth failed: {SECRET}"})

    with open(auditor.audit_path, "r", encoding="utf-8") as handle:
        content = handle.read()

    assert SECRET not in content
    assert "[REDACTED]" in content


def test_auditor_redacts_secrets_from_json_artefacts(tmp_path):
    redactor = Redactor([SECRET])
    auditor = Auditor(os.path.join(str(tmp_path), "run"), redactor=redactor)

    path = auditor.save_json("thing.json", {"detail": {"nested": f"key {SECRET}"}})
    with open(path, "r", encoding="utf-8") as handle:
        assert SECRET not in handle.read()


def test_auditor_redacts_secrets_from_jsonl_artefacts(tmp_path):
    redactor = Redactor([SECRET])
    auditor = Auditor(os.path.join(str(tmp_path), "run"), redactor=redactor)

    path = auditor.save_jsonl("rows.jsonl", [{"raw_response": f"echoed {SECRET}"}])
    with open(path, "r", encoding="utf-8") as handle:
        assert SECRET not in handle.read()


def test_no_secret_survives_a_full_run(tmp_path, monkeypatch):
    """End to end: set a key, run, and prove no artefact contains it."""
    monkeypatch.setenv("OPENAI_API_KEY", SECRET)
    run_dir = os.path.join(str(tmp_path), "run")

    run_model(model_key="mock", run_dir=run_dir, quiet=True)

    leaked = []
    for name in sorted(os.listdir(run_dir)):
        with open(os.path.join(run_dir, name), "r", encoding="utf-8") as handle:
            if SECRET in handle.read():
                leaked.append(name)

    assert not leaked, f"secret found in: {', '.join(leaked)}"


def test_opaque_secret_is_redacted_by_the_known_value_layer():
    """A credential matching no shape pattern must still be removed.

    This is the layer that catches a key echoed back inside a provider error.
    Pattern matching cannot help here — nothing about the string looks like a
    key until you know it is one.
    """
    unaware = Redactor()
    assert OPAQUE_SECRET in unaware.redact_text(f"token={OPAQUE_SECRET}")

    aware = Redactor([OPAQUE_SECRET])
    assert OPAQUE_SECRET not in aware.redact_text(f"token={OPAQUE_SECRET}")
    assert "[REDACTED]" in aware.redact_text(f"token={OPAQUE_SECRET}")


def test_opaque_secret_is_redacted_from_audit_artefacts(tmp_path):
    redactor = Redactor([OPAQUE_SECRET])
    auditor = Auditor(os.path.join(str(tmp_path), "run"), redactor=redactor)

    auditor.log_event("provider_error", {"error": f"denied for {OPAQUE_SECRET}"})
    auditor.save_json("meta.json", {"echo": OPAQUE_SECRET})
    auditor.save_jsonl("rows.jsonl", [{"raw_response": OPAQUE_SECRET}])

    for name in ("audit.jsonl", "meta.json", "rows.jsonl"):
        with open(os.path.join(auditor.run_dir, name), "r", encoding="utf-8") as handle:
            assert OPAQUE_SECRET not in handle.read(), name


def test_no_opaque_secret_survives_a_full_run(tmp_path, monkeypatch):
    """End to end with a non-shaped key: no artefact may contain it."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", OPAQUE_SECRET)
    run_dir = os.path.join(str(tmp_path), "run")

    run_model(model_key="mock", run_dir=run_dir, quiet=True)

    leaked = []
    for name in sorted(os.listdir(run_dir)):
        with open(os.path.join(run_dir, name), "r", encoding="utf-8") as handle:
            if OPAQUE_SECRET in handle.read():
                leaked.append(name)

    assert not leaked, f"opaque secret found in: {', '.join(leaked)}"


def test_sensitive_headers_are_dropped_wholesale():
    redactor = Redactor()
    result = redactor.redact(
        {"headers": {"Authorization": "anything at all", "X-Api-Key": "value", "Accept": "json"}}
    )

    assert result["headers"]["Authorization"] == "[REDACTED]"
    assert result["headers"]["X-Api-Key"] == "[REDACTED]"
    assert result["headers"]["Accept"] == "json"


def test_no_credentials_are_committed_to_the_repository():
    """Guard against a key pasted into config, data or source."""
    import re

    patterns = [
        re.compile(r"\bsk-[A-Za-z0-9]{20,}\b"),
        re.compile(r"\bAIza[A-Za-z0-9_\-]{30,}\b"),
        re.compile(r"(?i)api[_-]?key\s*[:=]\s*['\"][A-Za-z0-9_\-]{20,}['\"]"),
    ]
    offenders = []

    for root, dirs, files in os.walk(PROJECT_ROOT):
        dirs[:] = [d for d in dirs if d not in {"runs", "__pycache__", ".pytest_cache"}]
        for name in files:
            if not name.endswith((".py", ".yaml", ".yml", ".json", ".csv", ".txt", ".md")):
                continue
            path = os.path.join(root, name)
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    content = handle.read()
            except (UnicodeDecodeError, OSError):
                continue

            for pattern in patterns:
                for match in pattern.findall(content):
                    # Test fixtures deliberately contain fake key-shaped strings.
                    if "test" in match.lower() or "tests" in path:
                        continue
                    offenders.append(f"{os.path.relpath(path, PROJECT_ROOT)}: {match[:20]}…")

    assert not offenders, "Possible credentials committed: " + "; ".join(offenders)


def test_config_stores_env_var_names_not_values():
    import yaml

    with open(os.path.join(PROJECT_ROOT, "configs", "models.yaml"), "r", encoding="utf-8") as h:
        config = yaml.safe_load(h)

    for key, entry in config["models"].items():
        assert "api_key" not in {k.lower() for k in entry} or "api_key_env" in entry
        env_name = entry.get("api_key_env")
        if env_name:
            assert env_name.isupper(), f"{key}: {env_name} does not look like an env var name"
            assert not env_name.startswith("sk-")


# ----------------------------------------------------------------------
# §6: dataset manifest
# ----------------------------------------------------------------------


def test_dataset_manifest_pins_every_required_hash(prompt_renderer):
    manifest = build_dataset_manifest(
        dataset_path=DEFAULTS["dataset"],
        gold_path=DEFAULTS["gold"],
        taxonomy_path=DEFAULTS["taxonomy"],
        synonyms_path=DEFAULTS["synonyms"],
        critical_fields_path=DEFAULTS["critical_fields"],
        prompt_sha256=prompt_renderer.prompt_hash,
        prompt_name="classification",
        prompt_version="v0.1",
        dataset_kind=FIXTURE,
    )

    for key in (
        "dataset_sha256", "gold_sha256", "record_count", "product_id_hash",
        "taxonomy_sha256", "synonyms_sha256", "critical_fields_sha256", "prompt_sha256",
    ):
        assert manifest.get(key) is not None, key

    assert manifest["record_count"] == 15
    assert manifest["dataset_kind"] == FIXTURE


def test_product_id_hash_is_order_independent():
    """It answers 'same records?', not 'same file?'."""
    assert product_id_hash(["P1", "P2", "P3"]) == product_id_hash(["P3", "P1", "P2"])
    assert product_id_hash(["P1", "P2"]) != product_id_hash(["P1", "P3"])


def test_product_id_hash_ignores_duplicates_and_whitespace():
    assert product_id_hash(["P1", " P1 ", "P2"]) == product_id_hash(["P1", "P2"])


def test_verify_detects_dataset_drift():
    expected = {"dataset_sha256": "a", "gold_sha256": "b", "record_count": 15,
                "product_id_hash": "c", "taxonomy_sha256": "d", "synonyms_sha256": "e",
                "critical_fields_sha256": "f", "prompt_sha256": "g"}
    actual = {**expected, "gold_sha256": "CHANGED"}

    assert verify_dataset_manifest(expected, actual) == ["gold_sha256"]
    assert verify_dataset_manifest(expected, dict(expected)) == []


def test_shipped_dataset_manifest_matches_the_shipped_data():
    path = os.path.join(PROJECT_ROOT, "manifests", "dataset_manifest.json")
    with open(path, "r", encoding="utf-8") as handle:
        manifest = json.load(handle)

    assert manifest["record_count"] == len(read_ids(DEFAULTS["dataset"]))
    assert manifest["product_id_hash"] == product_id_hash(read_ids(DEFAULTS["dataset"]))
    assert manifest["dataset_kind"] == FIXTURE


def test_gate_fails_when_the_dataset_no_longer_matches_its_manifest(tmp_path, gate_builder):
    """A dataset edit after the manifest was built must block the run."""
    gate = gate_builder.build(dataset_ids=["P001", "P002"], gold_ids=["P001", "P002"])

    manifest_path = os.path.join(str(tmp_path), "dataset_manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "dataset_kind": FIXTURE,
                "dataset_sha256": "stale" * 12,
                "gold_sha256": "stale" * 12,
                "record_count": 99,
                "product_id_hash": "stale" * 12,
                "prompt_sha256": "stale" * 12,
            },
            handle,
        )

    gate.dataset_manifest_path = manifest_path
    check = gate.check_dataset_manifest(prompt_hash="anything")

    assert check["status"] == "FAIL"
    assert "no longer matches" in check["message"]


def test_gate_distinguishes_a_regenerated_file_from_a_changed_record_set(tmp_path, gate_builder):
    """Same records, different bytes: the message must say which happened."""
    gate = gate_builder.build(dataset_ids=["P001", "P002"], gold_ids=["P001", "P002"])

    from benchmark.utils import compute_file_hash

    real_ids = read_ids(gate_builder.dataset_path)
    manifest_path = os.path.join(str(tmp_path), "dm.json")
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "dataset_kind": FIXTURE,
                "dataset_sha256": "different-bytes",
                "gold_sha256": compute_file_hash(gate_builder.gold_path),
                "record_count": len(real_ids),
                "product_id_hash": product_id_hash(real_ids),
                "taxonomy_sha256": compute_file_hash(DEFAULTS["taxonomy"]),
                "synonyms_sha256": compute_file_hash(DEFAULTS["synonyms"]),
                "critical_fields_sha256": compute_file_hash(DEFAULTS["critical_fields"]),
                "prompt_sha256": "p",
            },
            handle,
        )

    gate.dataset_manifest_path = manifest_path
    check = gate.check_dataset_manifest(prompt_hash="p")

    assert check["status"] == "FAIL"
    assert any("product_id_hash is unchanged" in detail for detail in check["details"])


def test_manifest_builder_computes_hashes_rather_than_accepting_them():
    """No hash may be typed by hand into a manifest."""
    source = os.path.join(PROJECT_ROOT, "scripts", "build_manifest.py")
    with open(source, "r", encoding="utf-8") as handle:
        content = handle.read()

    import re

    literals = re.findall(r'"[a-f0-9]{64}"', content)
    assert not literals, f"hard-coded hashes in build_manifest.py: {literals}"
    assert "compute_file_hash" in content


def test_production_directory_exists_and_is_empty_of_data():
    """The repository ships no real catalogue data."""
    production = os.path.join(PROJECT_ROOT, "data", "production")
    assert os.path.isdir(production)

    data_files = [
        name for name in os.listdir(production) if name.endswith((".csv", ".jsonl"))
    ]
    assert not data_files, f"production data committed: {data_files}"
