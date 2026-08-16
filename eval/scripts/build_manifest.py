"""Build the integrity manifest.

Run this deliberately, never as part of a benchmark run. The manifest is what
the gate checks *against*; regenerating it automatically would mean the gate
verifies that the files match themselves, which is no verification at all.

    python -m scripts.build_manifest            # from the eval/ directory
    python scripts/build_manifest.py --check    # verify without writing
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
from benchmark.integrity_gate import CODE_FILES  # noqa: E402
from benchmark.prompt_renderer import PromptRenderer  # noqa: E402
from benchmark.utils import compute_file_hash  # noqa: E402
from benchmark.validator import Validator  # noqa: E402

PATHS = {
    "gold": os.path.join(PROJECT_ROOT, "data", "gold.csv"),
    "taxonomy": os.path.join(PROJECT_ROOT, "configs", "taxonomy.yaml"),
    "synonyms": os.path.join(PROJECT_ROOT, "configs", "synonyms.yaml"),
    "critical_fields": os.path.join(PROJECT_ROOT, "configs", "critical_fields.yaml"),
    "model_config": os.path.join(PROJECT_ROOT, "configs", "model_config.yaml"),
    "prompt": os.path.join(PROJECT_ROOT, "prompts", "classification_v0.1.txt"),
    "manifest": os.path.join(PROJECT_ROOT, "manifests", "manifest.json"),
    "code_dir": os.path.join(PROJECT_ROOT, "benchmark"),
}


def build() -> Dict[str, Any]:
    canonicalizer = Canonicalizer(PATHS["synonyms"])
    validator = Validator(
        taxonomy_path=PATHS["taxonomy"],
        critical_fields_path=PATHS["critical_fields"],
        canonicalizer=canonicalizer,
    )
    renderer = PromptRenderer(PATHS["prompt"], validator.taxonomy)

    code_hashes = {}
    for filename in CODE_FILES:
        path = os.path.join(PATHS["code_dir"], filename)
        if os.path.exists(path):
            code_hashes[filename] = compute_file_hash(path)

    return {
        "version": "2.0.4",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "gold_sha256": compute_file_hash(PATHS["gold"]),
        "taxonomy_sha256": compute_file_hash(PATHS["taxonomy"]),
        "synonyms_sha256": compute_file_hash(PATHS["synonyms"]),
        "critical_fields_sha256": compute_file_hash(PATHS["critical_fields"]),
        "model_config_sha256": compute_file_hash(PATHS["model_config"]),
        "prompt_sha256": renderer.prompt_hash,
        "code_hashes": code_hashes,
        "integrity_policy": {
            "require_evidence_verification": True,
            "block_on_leakage": True,
            "block_on_id_mismatch": True,
            "block_on_duplicate_ids": True,
        },
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Build or verify the integrity manifest")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Compare the current files against the stored manifest without writing",
    )
    args = parser.parse_args(argv)

    fresh = build()

    if args.check:
        if not os.path.exists(PATHS["manifest"]):
            print(f"❌ No manifest at {PATHS['manifest']}")
            return 1

        with open(PATHS["manifest"], "r", encoding="utf-8") as handle:
            stored = json.load(handle)

        drift = [
            key
            for key in fresh
            if key not in ("generated_at",) and stored.get(key) != fresh[key]
        ]
        if drift:
            print("❌ Manifest is stale. Drifted keys: " + ", ".join(drift))
            return 1

        print("✅ Manifest matches the current files.")
        return 0

    os.makedirs(os.path.dirname(PATHS["manifest"]), exist_ok=True)
    with open(PATHS["manifest"], "w", encoding="utf-8") as handle:
        json.dump(fresh, handle, indent=2, ensure_ascii=False)
        handle.write("\n")

    print(f"✅ Wrote {PATHS['manifest']}")
    for key, value in fresh.items():
        if key.endswith("_sha256"):
            print(f"   {key}: {value}")
    print(f"   code_hashes: {len(fresh['code_hashes'])} modules")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
