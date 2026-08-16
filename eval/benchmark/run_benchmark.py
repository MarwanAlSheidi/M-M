"""Benchmark entry point.

Order is not negotiable: build the components, render the prompt, run the
integrity gate, and only then classify. The gate needs the rendered prompt hash
and the model config, so it cannot run first; classification must not start
until the gate has returned PASS.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import yaml

from .auditor import Auditor
from .canonicalizer import Canonicalizer
from .classifier import build_classifier
from .cost_tracker import CostTracker
from .evaluator import Evaluator
from .exceptions import ConfigError, IntegrityError
from .integrity_gate import FAIL, IntegrityGate
from .leakage_detector import LeakageDetector
from .pipeline import Pipeline
from .prompt_renderer import PromptRenderer
from .utils import print_check_status
from .validator import Validator

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)

DEFAULTS = {
    "dataset": os.path.join(PROJECT_ROOT, "data", "dataset.csv"),
    "gold": os.path.join(PROJECT_ROOT, "data", "gold.csv"),
    "training": os.path.join(PROJECT_ROOT, "data", "training_ids.csv"),
    "taxonomy": os.path.join(PROJECT_ROOT, "configs", "taxonomy.yaml"),
    "synonyms": os.path.join(PROJECT_ROOT, "configs", "synonyms.yaml"),
    "critical_fields": os.path.join(PROJECT_ROOT, "configs", "critical_fields.yaml"),
    "model_config": os.path.join(PROJECT_ROOT, "configs", "model_config.yaml"),
    "prompt": os.path.join(PROJECT_ROOT, "prompts", "classification_v0.1.txt"),
    "manifest": os.path.join(PROJECT_ROOT, "manifests", "manifest.json"),
    "runs": os.path.join(PROJECT_ROOT, "runs"),
}


def load_model_config(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        raise ConfigError(f"Model config not found: {path}")
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
    except yaml.YAMLError as exc:
        raise ConfigError(f"Malformed model config YAML at {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError("Model config must be a mapping")
    return data


def build_components(paths: Dict[str, str]) -> Dict[str, Any]:
    """Construct every component from configuration."""
    canonicalizer = Canonicalizer(paths["synonyms"])
    validator = Validator(
        taxonomy_path=paths["taxonomy"],
        critical_fields_path=paths["critical_fields"],
        canonicalizer=canonicalizer,
    )
    prompt_renderer = PromptRenderer(paths["prompt"], validator.taxonomy)
    model_config = load_model_config(paths["model_config"])
    classifier = build_classifier(model_config, canonicalizer, validator.taxonomy)

    return {
        "canonicalizer": canonicalizer,
        "validator": validator,
        "prompt_renderer": prompt_renderer,
        "model_config": model_config,
        "classifier": classifier,
    }


def run(
    paths: Optional[Dict[str, str]] = None,
    run_dir: Optional[str] = None,
    strict: bool = True,
) -> Dict[str, Any]:
    """Run the benchmark end to end. Returns the evaluation document."""
    paths = {**DEFAULTS, **(paths or {})}

    run_dir = run_dir or os.path.join(
        paths["runs"], datetime.now(timezone.utc).strftime("run_%Y%m%dT%H%M%SZ")
    )
    os.makedirs(run_dir, exist_ok=True)

    components = build_components(paths)
    validator = components["validator"]
    canonicalizer = components["canonicalizer"]
    prompt_renderer = components["prompt_renderer"]
    model_config = components["model_config"]

    auditor = Auditor(run_dir)
    auditor.log_event(
        "run_started",
        {"run_dir": run_dir, "paths": paths, "strict": strict},
    )

    # The gate checks gold *columns*, so hand it the taxonomy keyed by gold
    # column name rather than by field name.
    gold_keyed_taxonomy = {
        validator.gold_column(field): values
        for field, values in validator.taxonomy.items()
    }

    gate = IntegrityGate(
        manifest_path=paths["manifest"],
        gold_path=paths["gold"],
        dataset_path=paths["dataset"],
        taxonomy_path=paths["taxonomy"],
        synonyms_path=paths["synonyms"],
        critical_fields_path=paths["critical_fields"],
        training_data_path=paths["training"],
        code_dir=PACKAGE_DIR,
    )
    gate_result = gate.run(
        taxonomy=gold_keyed_taxonomy,
        prompt_hash=prompt_renderer.prompt_hash,
        model_config=paths["model_config"],
    )

    auditor.log_event("integrity_gate", gate_result)
    auditor.save_json("integrity_report.json", gate_result)
    print_check_status(gate_result)

    if gate_result["overall"] == FAIL and strict:
        raise IntegrityError(
            "Integrity gate FAILED; benchmark execution blocked. "
            + gate_result["summary"]
        )

    leakage_detector = LeakageDetector.from_csv(
        paths["training"], text_columns=["product_name_raw", "description_raw"]
    )

    pipeline = Pipeline(
        run_dir=run_dir,
        validator=validator,
        canonicalizer=canonicalizer,
        prompt_renderer=prompt_renderer,
        classifier=components["classifier"],
        cost_tracker=CostTracker.from_config(model_config),
        leakage_detector=leakage_detector,
        auditor=auditor,
    )

    pipeline.load_dataset(paths["dataset"])
    pipeline.load_gold(paths["gold"])
    pipeline.run_classification()
    artefacts = pipeline.save_predictions()

    evaluator = Evaluator(
        canonicalizer=canonicalizer,
        critical_fields=validator.critical_fields,
        secondary_fields=validator.secondary_fields,
        gold_columns=validator.gold_columns,
    )
    results = evaluator.evaluate(pipeline.predictions_final, pipeline.gold_lookup)

    # Cost needs per-record correctness, so it is joined after evaluation and
    # then folded back into the result document.
    results["cost"] = pipeline.record_costs(results)

    results["run"] = {
        "version": "2.0.4",
        "run_dir": run_dir,
        "prompt_sha256": prompt_renderer.prompt_hash,
        "integrity": {
            "overall": gate_result["overall"],
            "summary": gate_result["summary"],
            "passed_count": gate_result["passed_count"],
            "failed_count": gate_result["failed_count"],
            "warning_count": gate_result["warning_count"],
        },
        "model_config": model_config,
        "artefacts": artefacts,
    }

    auditor.save_json("evaluation_results.json", results)
    auditor.log_event("run_complete", results["headline"])

    _print_summary(results)
    return results


def _print_summary(results: Dict[str, Any]) -> None:
    headline = results["headline"]
    cost = results.get("cost") or {}

    print()
    print("=" * 70)
    print("BENCHMARK RESULTS")
    print("=" * 70)
    print(f"records               : {results['total_records']}")
    print(f"macro accuracy (final): {headline['macro_accuracy'] * 100:.2f}%")
    print(f"exact match           : {headline['exact_match'] * 100:.2f}%")
    print(f"critical exact match  : {headline['critical_exact_match'] * 100:.2f}%")
    print(f"macro F1              : {headline['macro_f1'] * 100:.2f}%")
    print(f"abstention rate       : {headline['abstention_rate'] * 100:.2f}%")
    print(f"selective accuracy    : {headline['selective_accuracy'] * 100:.2f}%")
    print(f"critical error rate   : {headline['critical_field_error_rate'] * 100:.2f}%")
    print(f"evidence support rate : {headline['evidence_support_rate'] * 100:.2f}%")
    print(f"total cost (USD)      : {cost.get('total_cost_usd', 0)}")
    print("-" * 70)

    for level, block in results["levels"].items():
        print(
            f"{level:<10} macro_acc={block['macro_accuracy'] * 100:6.2f}%  "
            f"exact={block['exact_match'] * 100:6.2f}%  "
            f"critical_exact={block['critical_exact_match'] * 100:6.2f}%"
        )
    print("=" * 70)


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(description="Run the abaya classification benchmark")
    parser.add_argument("--dataset", default=DEFAULTS["dataset"])
    parser.add_argument("--gold", default=DEFAULTS["gold"])
    parser.add_argument("--training", default=DEFAULTS["training"])
    parser.add_argument("--manifest", default=DEFAULTS["manifest"])
    parser.add_argument("--model-config", dest="model_config", default=DEFAULTS["model_config"])
    parser.add_argument("--run-dir", dest="run_dir", default=None)
    parser.add_argument(
        "--no-strict",
        action="store_true",
        help="Report integrity failures without blocking execution (never use for a release run)",
    )
    args = parser.parse_args(argv)

    paths = {
        **DEFAULTS,
        "dataset": args.dataset,
        "gold": args.gold,
        "training": args.training,
        "manifest": args.manifest,
        "model_config": args.model_config,
    }

    try:
        run(paths=paths, run_dir=args.run_dir, strict=not args.no_strict)
    except IntegrityError as exc:
        print(f"\n❌ INTEGRITY FAILURE: {exc}", file=sys.stderr)
        return 2
    except ConfigError as exc:
        print(f"\n❌ CONFIGURATION ERROR: {exc}", file=sys.stderr)
        return 3

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
