"""Build the integrity and dataset manifests.

Run this deliberately, never as part of a benchmark run. The manifest is what
the gate checks *against*; regenerating it automatically would mean the gate
verifies that the files match themselves, which is no verification at all.

Every hash is computed here. None is ever typed by hand.

    python scripts/build_manifest.py              # fixture dataset
    python scripts/build_manifest.py --production # data/production/
    python scripts/build_manifest.py --check      # verify without writing
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

from benchmark.canonicalizer import Canonicalizer  # noqa: E402
from benchmark.dataset_manifest import (  # noqa: E402
    FIXTURE,
    PRODUCTION,
    build_dataset_manifest,
)
from benchmark.integrity_gate import CODE_FILES  # noqa: E402
from benchmark.prompt_renderer import PromptRenderer  # noqa: E402
from benchmark.utils import compute_file_hash  # noqa: E402
from benchmark.validator import Validator  # noqa: E402

VERSION = "2.0.5"
PROMPT_NAME = "classification"
PROMPT_VERSION = "v0.1"

CONFIGS = os.path.join(PROJECT_ROOT, "configs")
DATA = os.path.join(PROJECT_ROOT, "data")
PRODUCTION_DATA = os.path.join(DATA, "production")

PATHS = {
    "gold": os.path.join(DATA, "gold.csv"),
    "dataset": os.path.join(DATA, "dataset.csv"),
    "training": os.path.join(DATA, "training_ids.csv"),
    "validation": os.path.join(DATA, "validation_ids.csv"),
    "taxonomy": os.path.join(CONFIGS, "taxonomy.yaml"),
    "synonyms": os.path.join(CONFIGS, "synonyms.yaml"),
    "critical_fields": os.path.join(CONFIGS, "critical_fields.yaml"),
    "model_config": os.path.join(CONFIGS, "model_config.yaml"),
    "models": os.path.join(CONFIGS, "models.yaml"),
    "pricing": os.path.join(CONFIGS, "pricing.yaml"),
    "prompt": os.path.join(PROJECT_ROOT, "prompts", "classification_v0.1.txt"),
    "manifest": os.path.join(PROJECT_ROOT, "manifests", "manifest.json"),
    "dataset_manifest": os.path.join(PROJECT_ROOT, "manifests", "dataset_manifest.json"),
    "code_dir": os.path.join(PROJECT_ROOT, "benchmark"),
}

PRODUCTION_PATHS = {
    "dataset": os.path.join(PRODUCTION_DATA, "dataset.csv"),
    "gold": os.path.join(PRODUCTION_DATA, "gold.csv"),
    "training": os.path.join(PRODUCTION_DATA, "training_ids.csv"),
    "validation": os.path.join(PRODUCTION_DATA, "validation_ids.csv"),
    "dataset_manifest": os.path.join(
        PROJECT_ROOT, "manifests", "dataset_manifest_production.json"
    ),
}


def _renderer() -> PromptRenderer:
    canonicalizer = Canonicalizer(PATHS["synonyms"])
    validator = Validator(
        taxonomy_path=PATHS["taxonomy"],
        critical_fields_path=PATHS["critical_fields"],
        canonicalizer=canonicalizer,
    )
    return PromptRenderer(PATHS["prompt"], validator.taxonomy)


def build_integrity_manifest() -> Dict[str, Any]:
    """Hashes for every artefact the integrity gate verifies."""
    renderer = _renderer()

    code_hashes = {}
    for filename in CODE_FILES:
        path = os.path.join(PATHS["code_dir"], filename)
        if os.path.exists(path):
            code_hashes[filename] = compute_file_hash(path)

    manifest = {
        "version": VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "gold_sha256": compute_file_hash(PATHS["gold"]),
        "dataset_sha256": compute_file_hash(PATHS["dataset"]),
        "taxonomy_sha256": compute_file_hash(PATHS["taxonomy"]),
        "synonyms_sha256": compute_file_hash(PATHS["synonyms"]),
        "critical_fields_sha256": compute_file_hash(PATHS["critical_fields"]),
        "model_config_sha256": compute_file_hash(PATHS["model_config"]),
        "prompt_sha256": renderer.prompt_hash,
        "prompt_name": PROMPT_NAME,
        "prompt_version": PROMPT_VERSION,
        "code_hashes": code_hashes,
        "integrity_policy": {
            "require_evidence_verification": True,
            "block_on_leakage": True,
            "block_on_id_mismatch": True,
            "block_on_duplicate_ids": True,
            "block_on_split_contamination": True,
            "block_on_dataset_manifest_drift": True,
        },
    }

    # v2.0.5 configs. Optional so the manifest stays buildable in a checkout
    # that has not adopted them yet.
    for key, manifest_key in (("models", "models_sha256"), ("pricing", "pricing_sha256")):
        if os.path.exists(PATHS[key]):
            manifest[manifest_key] = compute_file_hash(PATHS[key])

    return manifest


def build_data_manifest(production: bool = False) -> Dict[str, Any]:
    """Immutability pin for one dataset: content hashes plus the id-set hash."""
    renderer = _renderer()
    paths = {**PATHS, **(PRODUCTION_PATHS if production else {})}

    missing = [
        name for name in ("dataset", "gold") if not os.path.exists(paths[name])
    ]
    if missing:
        raise FileNotFoundError(
            f"Cannot build a {'production' if production else 'fixture'} dataset manifest; "
            f"missing: {', '.join(paths[name] for name in missing)}"
        )

    return build_dataset_manifest(
        dataset_path=paths["dataset"],
        gold_path=paths["gold"],
        taxonomy_path=PATHS["taxonomy"],
        synonyms_path=PATHS["synonyms"],
        critical_fields_path=PATHS["critical_fields"],
        prompt_sha256=renderer.prompt_hash,
        prompt_name=PROMPT_NAME,
        prompt_version=PROMPT_VERSION,
        dataset_kind=PRODUCTION if production else FIXTURE,
        training_path=paths.get("training") if os.path.exists(paths.get("training", "")) else None,
        validation_path=(
            paths.get("validation") if os.path.exists(paths.get("validation", "")) else None
        ),
    )


def _write(path: str, payload: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Build or verify the manifests")
    parser.add_argument("--check", action="store_true",
                        help="Compare current files against the stored manifests")
    parser.add_argument("--production", action="store_true",
                        help="Also build the production dataset manifest from data/production/")
    args = parser.parse_args(argv)

    integrity = build_integrity_manifest()
    dataset = build_data_manifest(production=False)

    if args.check:
        failures = []

        for label, path, fresh in (
            ("integrity", PATHS["manifest"], integrity),
            ("dataset", PATHS["dataset_manifest"], dataset),
        ):
            if not os.path.exists(path):
                failures.append(f"{label}: no manifest at {path}")
                continue

            with open(path, "r", encoding="utf-8") as handle:
                stored = json.load(handle)

            drift = [
                key
                for key in fresh
                if key not in ("generated_at",) and stored.get(key) != fresh[key]
            ]
            if drift:
                failures.append(f"{label}: drifted keys — {', '.join(drift)}")

        if failures:
            for failure in failures:
                print(f"❌ {failure}")
            return 1

        print("✅ Manifests match the current files.")
        return 0

    _write(PATHS["manifest"], integrity)
    _write(PATHS["dataset_manifest"], dataset)

    print(f"✅ Wrote {PATHS['manifest']}")
    for key, value in integrity.items():
        if key.endswith("_sha256"):
            print(f"   {key}: {value}")
    print(f"   code_hashes: {len(integrity['code_hashes'])} modules")

    print(f"✅ Wrote {PATHS['dataset_manifest']}")
    print(f"   dataset_kind: {dataset['dataset_kind']}")
    print(f"   record_count: {dataset['record_count']}")
    print(f"   product_id_hash: {dataset['product_id_hash']}")

    if args.production:
        try:
            production = build_data_manifest(production=True)
        except FileNotFoundError as exc:
            print(f"⚠️  {exc}")
            return 0
        _write(PRODUCTION_PATHS["dataset_manifest"], production)
        print(f"✅ Wrote {PRODUCTION_PATHS['dataset_manifest']}")
        print(f"   record_count: {production['record_count']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
