"""Benchmark entry point — single model, batch, dry run and resume.

Order is not negotiable: build the components, render the prompt, run the
integrity gate, and only then classify. The gate needs the rendered prompt hash
and the model config, so it cannot run first; classification must not start
until the gate has returned PASS.

Every model in a batch shares one prompt hash, one dataset, one gold file, one
taxonomy and one evaluator. That is enforced here rather than trusted: a batch
renders the prompt exactly once and passes the same hash to every run.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import yaml

from .auditor import Auditor
from .canonicalizer import Canonicalizer
from .comparison import compare_models, write_comparison_csv
from .cost_tracker import CostTracker
from .dataset_manifest import FIXTURE, PRODUCTION, SplitRegistry
from .error_analysis import annotate_errors
from .evaluator import Evaluator
from .exceptions import ClassifierError, ConfigError, IntegrityError
from .integrity_gate import FAIL, IntegrityGate
from .leakage_detector import LeakageDetector
from .model_registry import ModelRegistry
from .pipeline import Pipeline
from .pricing import PricingTable
from .prompt_renderer import PromptRenderer
from .providers import build_provider
from .redaction import Redactor
from .reporting import (
    build_report,
    result_label,
    write_confusion_csv,
    write_dashboard_csv,
    write_report_csv,
    write_report_json,
    write_report_markdown,
)
from .review_sample import build_review_sample, source_text_index
from .run_context import (
    Checkpoint,
    RunFingerprint,
    assert_resumable,
    build_run_id,
    find_latest_run,
)
from .statistics import DEFAULT_CONFIDENCE, wilson_interval
from .utils import compute_dict_hash, compute_file_hash, print_check_status
from .validator import Validator

VERSION = "2.0.5"

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)

PROMPT_NAME = "classification"
PROMPT_VERSION = "v0.1"

DEFAULTS = {
    "dataset": os.path.join(PROJECT_ROOT, "data", "dataset.csv"),
    "gold": os.path.join(PROJECT_ROOT, "data", "gold.csv"),
    "training": os.path.join(PROJECT_ROOT, "data", "training_ids.csv"),
    "validation": os.path.join(PROJECT_ROOT, "data", "validation_ids.csv"),
    "taxonomy": os.path.join(PROJECT_ROOT, "configs", "taxonomy.yaml"),
    "synonyms": os.path.join(PROJECT_ROOT, "configs", "synonyms.yaml"),
    "critical_fields": os.path.join(PROJECT_ROOT, "configs", "critical_fields.yaml"),
    "model_config": os.path.join(PROJECT_ROOT, "configs", "model_config.yaml"),
    "models": os.path.join(PROJECT_ROOT, "configs", "models.yaml"),
    "pricing": os.path.join(PROJECT_ROOT, "configs", "pricing.yaml"),
    "prompt": os.path.join(PROJECT_ROOT, "prompts", "classification_v0.1.txt"),
    "manifest": os.path.join(PROJECT_ROOT, "manifests", "manifest.json"),
    "dataset_manifest": os.path.join(PROJECT_ROOT, "manifests", "dataset_manifest.json"),
    "runs": os.path.join(PROJECT_ROOT, "runs"),
}

# Everything under data/production/ is real catalogue data; anything else is
# the synthetic fixture. Reports are labelled from this, not from a flag the
# operator has to remember to set.
PRODUCTION_DIR = os.path.join(PROJECT_ROOT, "data", "production")


def load_yaml_mapping(path: str, label: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        raise ConfigError(f"{label} not found: {path}")
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
    except yaml.YAMLError as exc:
        raise ConfigError(f"Malformed {label} YAML at {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError(f"{label} must be a mapping")
    return data


def load_model_config(path: str) -> Dict[str, Any]:
    """The v2.0.4 single-model config. Kept for backward compatibility."""
    return load_yaml_mapping(path, "Model config")


def classify_dataset_kind(dataset_path: str) -> str:
    """Fixture unless the dataset lives under data/production/."""
    try:
        resolved = os.path.realpath(dataset_path)
        return PRODUCTION if resolved.startswith(os.path.realpath(PRODUCTION_DIR)) else FIXTURE
    except OSError:
        return FIXTURE


def code_hash(paths_dir: str = PACKAGE_DIR) -> str:
    """One hash over every benchmark module, for the run fingerprint."""
    digests = {}
    for name in sorted(os.listdir(paths_dir)):
        if name.endswith(".py"):
            digests[name] = compute_file_hash(os.path.join(paths_dir, name))
    return compute_dict_hash(digests)


def build_components(paths: Dict[str, str]) -> Dict[str, Any]:
    """Construct every shared component. Identical for every model in a batch."""
    canonicalizer = Canonicalizer(paths["synonyms"])
    validator = Validator(
        taxonomy_path=paths["taxonomy"],
        critical_fields_path=paths["critical_fields"],
        canonicalizer=canonicalizer,
    )
    prompt_renderer = PromptRenderer(paths["prompt"], validator.taxonomy)
    model_config = load_model_config(paths["model_config"])

    registry = None
    pricing = None
    if os.path.exists(paths.get("models", "")):
        registry = ModelRegistry.from_yaml(paths["models"])
    if os.path.exists(paths.get("pricing", "")):
        pricing = PricingTable.from_yaml(paths["pricing"])

    return {
        "canonicalizer": canonicalizer,
        "validator": validator,
        "prompt_renderer": prompt_renderer,
        "model_config": model_config,
        "registry": registry,
        "pricing": pricing,
    }


def build_redactor(registry: Optional[ModelRegistry]) -> Redactor:
    """A redactor that knows this run's actual credential values.

    Reads the values out of the environment so a key echoed back inside a
    provider error is scrubbed even though no pattern would recognise it.
    """
    redactor = Redactor()
    names = registry.secret_env_names() if registry else []
    redactor.register_env(*names, "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY")
    return redactor


def build_fingerprint(
    paths: Dict[str, str],
    prompt_hash: str,
    model_config_hash: str,
) -> RunFingerprint:
    def maybe_hash(path: Optional[str]) -> Optional[str]:
        return compute_file_hash(path) if path and os.path.exists(path) else None

    return RunFingerprint(
        {
            "dataset_sha256": maybe_hash(paths.get("dataset")),
            "gold_sha256": maybe_hash(paths.get("gold")),
            "prompt_sha256": prompt_hash,
            "taxonomy_sha256": maybe_hash(paths.get("taxonomy")),
            "synonyms_sha256": maybe_hash(paths.get("synonyms")),
            "critical_fields_sha256": maybe_hash(paths.get("critical_fields")),
            "model_config_sha256": model_config_hash,
            "pricing_sha256": maybe_hash(paths.get("pricing")),
            "code_sha256": code_hash(),
        }
    )


# ----------------------------------------------------------------------
# Dry run
# ----------------------------------------------------------------------


def dry_run(
    model_keys: List[str],
    paths: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Validate everything and call no model at all.

    Verifies configuration, integrity, dataset, gold, prompt and model
    availability. The API call count is asserted to be zero by construction:
    no classifier is built and no provider is instantiated.
    """
    paths = {**DEFAULTS, **(paths or {})}
    components = build_components(paths)
    validator = components["validator"]
    registry = components["registry"]
    prompt_renderer = components["prompt_renderer"]

    if registry is None:
        raise ConfigError(f"Model registry not found: {paths['models']}")

    gold_keyed_taxonomy = {
        validator.gold_column(field): values for field, values in validator.taxonomy.items()
    }

    gate = _build_gate(paths)
    gate_result = gate.run(
        taxonomy=gold_keyed_taxonomy,
        prompt_hash=prompt_renderer.prompt_hash,
        model_config=paths["model_config"],
    )

    availability = registry.availability()
    requested = {key: availability.get(key) for key in model_keys}

    models_ok = all(
        entry is not None and entry.get("enabled") and entry.get("credentials_available")
        for entry in requested.values()
    )

    return {
        "dry_run": True,
        "benchmark_version": VERSION,
        "api_call_count": 0,
        "integrity": gate_result["overall"],
        "integrity_summary": gate_result["summary"],
        "configuration": "PASS" if registry is not None else "FAIL",
        "dataset": "PASS" if os.path.exists(paths["dataset"]) else "FAIL",
        "gold": "PASS" if os.path.exists(paths["gold"]) else "FAIL",
        "prompt": "PASS" if prompt_renderer.render() else "FAIL",
        "prompt_sha256": prompt_renderer.prompt_hash,
        "prompt_name": PROMPT_NAME,
        "prompt_version": PROMPT_VERSION,
        "dataset_kind": classify_dataset_kind(paths["dataset"]),
        "model_configuration": "PASS" if models_ok else "INCOMPLETE",
        "models": requested,
        "checks": gate_result["checks"],
    }


def _build_gate(paths: Dict[str, str]) -> IntegrityGate:
    return IntegrityGate(
        manifest_path=paths["manifest"],
        gold_path=paths["gold"],
        dataset_path=paths["dataset"],
        taxonomy_path=paths["taxonomy"],
        synonyms_path=paths["synonyms"],
        critical_fields_path=paths["critical_fields"],
        training_data_path=paths.get("training"),
        code_dir=PACKAGE_DIR,
        validation_data_path=(
            paths.get("validation") if os.path.exists(paths.get("validation", "")) else None
        ),
        dataset_manifest_path=(
            paths.get("dataset_manifest")
            if os.path.exists(paths.get("dataset_manifest", ""))
            else None
        ),
        pricing_path=paths.get("pricing") if os.path.exists(paths.get("pricing", "")) else None,
        models_path=paths.get("models") if os.path.exists(paths.get("models", "")) else None,
    )


# ----------------------------------------------------------------------
# Single model
# ----------------------------------------------------------------------


def run_model(
    model_key: str = "mock",
    paths: Optional[Dict[str, str]] = None,
    run_dir: Optional[str] = None,
    run_id: Optional[str] = None,
    strict: bool = True,
    resume: bool = False,
    max_records: Optional[int] = None,
    components: Optional[Dict[str, Any]] = None,
    prompt_hash_override: Optional[str] = None,
    client: Any = None,
    quiet: bool = False,
) -> Dict[str, Any]:
    """Run one model end to end and return its evaluation document."""
    paths = {**DEFAULTS, **(paths or {})}
    components = components or build_components(paths)

    validator = components["validator"]
    canonicalizer = components["canonicalizer"]
    prompt_renderer = components["prompt_renderer"]
    registry: Optional[ModelRegistry] = components.get("registry")
    pricing: Optional[PricingTable] = components.get("pricing")

    if registry is None:
        raise ConfigError(f"Model registry not found: {paths['models']}")

    model = registry.get(model_key)
    prompt_hash = prompt_hash_override or prompt_renderer.prompt_hash

    # Every model in a batch must see the identical prompt. If a caller passed
    # a hash, it must be the one this renderer produces.
    if prompt_hash != prompt_renderer.prompt_hash:
        raise IntegrityError(
            "Prompt hash mismatch between models in one batch: "
            f"{prompt_hash} != {prompt_renderer.prompt_hash}"
        )

    fingerprint = build_fingerprint(paths, prompt_hash, model.config_hash)
    dataset_kind = classify_dataset_kind(paths["dataset"])

    resolved_run_id = run_id or build_run_id(model_key, fingerprint)
    if run_dir is None:
        run_dir = os.path.join(paths["runs"], resolved_run_id)

    redactor = build_redactor(registry)
    auditor = Auditor(run_dir, redactor=redactor)
    auditor.log_event(
        "run_started",
        {
            "run_id": resolved_run_id,
            "benchmark_version": VERSION,
            "model_key": model_key,
            "provider": model.provider,
            "model_id": model.model,
            "dataset_kind": dataset_kind,
            "determinism_supported": model.determinism_supported,
            "fingerprint": fingerprint.as_dict(),
        },
    )

    # ---------------- integrity ----------------

    gold_keyed_taxonomy = {
        validator.gold_column(field): values for field, values in validator.taxonomy.items()
    }
    gate = _build_gate(paths)
    gate_result = gate.run(
        taxonomy=gold_keyed_taxonomy,
        prompt_hash=prompt_hash,
        model_config=paths["model_config"],
    )

    auditor.log_event("integrity_gate", gate_result)
    auditor.save_json("integrity_report.json", gate_result)
    if not quiet:
        print_check_status(gate_result)

    if gate_result["overall"] == FAIL and strict:
        raise IntegrityError(
            "Integrity gate FAILED; benchmark execution blocked. " + gate_result["summary"]
        )

    # Splits are enforced again here, not merely reported by the gate.
    splits = SplitRegistry.from_paths(
        training_path=paths.get("training") if os.path.exists(paths.get("training", "")) else None,
        validation_path=(
            paths.get("validation") if os.path.exists(paths.get("validation", "")) else None
        ),
        evaluation_path=paths["dataset"],
    )
    if strict:
        splits.assert_clean()

    # ---------------- classifier ----------------

    classifier = build_provider(
        model,
        canonicalizer=canonicalizer,
        taxonomy=validator.taxonomy,
        pricing=pricing,
        client=client,
        redactor=redactor,
    )

    leakage_detector = LeakageDetector.from_csv(
        paths["training"], text_columns=["product_name_raw", "description_raw"]
    )

    pipeline = Pipeline(
        run_dir=run_dir,
        validator=validator,
        canonicalizer=canonicalizer,
        prompt_renderer=prompt_renderer,
        classifier=classifier,
        cost_tracker=CostTracker.from_config(components["model_config"]),
        leakage_detector=leakage_detector,
        auditor=auditor,
    )

    pipeline.load_dataset(paths["dataset"])
    pipeline.load_gold(paths["gold"])

    if max_records is not None and max_records > 0:
        # Truncating changes the evaluated record set, so gold is truncated to
        # match — otherwise alignment would fail, which it should.
        keep = pipeline.dataset_df["product_id"].head(max_records).tolist()
        pipeline.dataset_df = pipeline.dataset_df[pipeline.dataset_df["product_id"].isin(keep)]
        pipeline.gold_df = pipeline.gold_df[pipeline.gold_df["product_id"].isin(keep)]
        pipeline.gold_lookup = {
            key: value for key, value in pipeline.gold_lookup.items() if key in set(keep)
        }
        auditor.log_event("max_records_applied", {"records": len(keep)})

    # ---------------- resume ----------------

    checkpoint = Checkpoint(
        run_id=resolved_run_id,
        model_key=model_key,
        fingerprint=fingerprint.as_dict(),
        dataset_kind=dataset_kind,
    )

    if resume:
        restored = _restore(pipeline, run_dir, fingerprint, model_key, checkpoint, auditor)
        auditor.log_event("resume", {"restored_records": restored})

    def _checkpoint(product_id: str, _raw_record: Dict[str, Any]) -> None:
        checkpoint.mark(product_id)
        checkpoint.save(run_dir)

    pipeline.on_record_complete = _checkpoint

    # ---------------- classify ----------------

    pipeline.run_classification()
    artefacts = pipeline.save_predictions()
    checkpoint.save(run_dir)

    # ---------------- evaluate ----------------

    evaluator = Evaluator(
        canonicalizer=canonicalizer,
        critical_fields=validator.critical_fields,
        secondary_fields=validator.secondary_fields,
        gold_columns=validator.gold_columns,
    )
    results = evaluator.evaluate(pipeline.predictions_final, pipeline.gold_lookup)

    results["cost"] = pipeline.record_costs(results)
    annotate_errors(results, pipeline.predictions_final)

    final_level = results["levels"]["final"]
    results["operations"] = pipeline.cost_tracker.operations_summary(
        exact_matches=final_level.get("exact_match_count", 0),
        accuracy=results["headline"].get("micro_accuracy"),
    )
    results["confidence_intervals"] = _confidence_intervals(results)
    results["per_field_operations"] = _per_field_operations(
        pipeline.predictions_final, validator.fields
    )

    label = result_label(dataset_kind, [model.provider])

    results["run"] = {
        "version": VERSION,
        "run_id": resolved_run_id,
        "run_dir": run_dir,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "model_key": model_key,
        "provider": model.provider,
        "model_id": model.model,
        "classifier": model.classifier,
        "temperature": model.temperature,
        "seed": model.seed,
        "max_tokens": model.max_tokens,
        "determinism_supported": model.determinism_supported,
        "determinism_note": (
            "Provider supports a sampling seed."
            if model.determinism_supported
            else "Provider offers no reproducible sampling; identical output is not guaranteed."
        ),
        "dataset_kind": dataset_kind,
        "result_class": label["result_class"],
        "prompt_name": PROMPT_NAME,
        "prompt_version": PROMPT_VERSION,
        "prompt_sha256": prompt_hash,
        "model_config_sha256": model.config_hash,
        "fingerprint": fingerprint.as_dict(),
        "splits": splits.summary(),
        "pricing": (
            pricing.describe(model.provider, model.model or model.key) if pricing else None
        ),
        "rate_limit": getattr(classifier, "rate_limiter", None).summary()
        if getattr(classifier, "rate_limiter", None)
        else None,
        "resumed_records": pipeline.skipped_completed,
        "integrity": {
            "overall": gate_result["overall"],
            "summary": gate_result["summary"],
            "passed_count": gate_result["passed_count"],
            "failed_count": gate_result["failed_count"],
            "warning_count": gate_result["warning_count"],
        },
        "model_config": components["model_config"],
        "artefacts": artefacts,
    }

    auditor.save_json("evaluation_results.json", results)
    auditor.save_json("cost_summary.json", {
        "token_pricing_tracker": results["cost"],
        "operations": results["operations"],
    })
    auditor.save_json("metadata.json", results["run"])
    write_confusion_csv(results, os.path.join(run_dir, "confusion_matrices.csv"))

    auditor.log_event("run_complete", results["headline"])

    if not quiet:
        _print_summary(results)

    return results


def _restore(
    pipeline: Pipeline,
    run_dir: str,
    fingerprint: RunFingerprint,
    model_key: str,
    checkpoint: Checkpoint,
    auditor: Auditor,
) -> int:
    """Load a previous run's completed records, refusing on any drift."""
    previous = Checkpoint.load(run_dir)
    if previous is None:
        auditor.log_event("resume_skipped", {"reason": "no checkpoint in run_dir"})
        return 0

    assert_resumable(previous, fingerprint, model_key)

    raw_path = os.path.join(run_dir, "predictions_raw.jsonl")
    if not os.path.exists(raw_path):
        auditor.log_event("resume_skipped", {"reason": "no predictions_raw.jsonl"})
        return 0

    completed = previous.completed
    records: List[Dict[str, Any]] = []
    # Streamed, not slurped: a production run's raw file can be large.
    with open(raw_path, "r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            record = json.loads(line)
            if str(record.get("product_id")) in completed:
                records.append(record)

    checkpoint.completed_ids = list(previous.completed_ids)
    return pipeline.restore_completed(records)


def _confidence_intervals(results: Dict[str, Any], confidence: float = DEFAULT_CONFIDENCE):
    """Wilson intervals for the metrics people quote."""
    final = results["levels"]["final"]
    records = results["total_records"]

    intervals = {
        "confidence_level": confidence,
        "method": "wilson",
        "accuracy": wilson_interval(
            final.get("total_correct", 0), final.get("total_observations", 0), confidence
        ),
        "exact_match": wilson_interval(final.get("exact_match_count", 0), records, confidence),
        "critical_exact_match": wilson_interval(
            final.get("critical_exact_match_count", 0), records, confidence
        ),
        "per_field": {},
        "caution": (
            "Overlapping intervals are not a significance test, and "
            "non-overlapping ones are not either. Use the paired McNemar result."
        ),
    }

    for field, metrics in (final.get("field_metrics") or {}).items():
        intervals["per_field"][field] = wilson_interval(
            metrics.get("correct", 0), metrics.get("total", 0), confidence
        )

    return intervals


def _per_field_operations(predictions: List[Dict[str, Any]], fields: List[str]):
    """Abstention and evidence support per field, for the comparison matrix."""
    summary: Dict[str, Dict[str, Any]] = {}

    for field in fields:
        total = abstained = supported = non_null = 0

        for record in predictions:
            entry = record.get(field)
            if not isinstance(entry, dict):
                continue

            total += 1
            if entry.get("decision") == "ABSTAIN":
                abstained += 1
            if entry.get("final") is not None:
                non_null += 1
                if entry.get("evidence_status") in ("SUPPORTED", "PARTIAL"):
                    supported += 1

        summary[field] = {
            "predictions": total,
            "abstentions": abstained,
            "abstention_rate": round(abstained / total, 6) if total else 0.0,
            "evidence_support_rate": round(supported / non_null, 6) if non_null else 0.0,
        }

    return summary


# ----------------------------------------------------------------------
# Batch
# ----------------------------------------------------------------------


def run_batch(
    model_keys: List[str],
    paths: Optional[Dict[str, str]] = None,
    runs_root: Optional[str] = None,
    strict: bool = True,
    resume: bool = False,
    max_records: Optional[int] = None,
    review_sample: Optional[int] = None,
    client: Any = None,
    quiet: bool = False,
) -> Dict[str, Any]:
    """Run several models against identical inputs and compare them."""
    paths = {**DEFAULTS, **(paths or {})}
    components = build_components(paths)
    registry: Optional[ModelRegistry] = components["registry"]

    if registry is None:
        raise ConfigError(f"Model registry not found: {paths['models']}")

    # Rendered once, shared by every model. This is the mechanism behind
    # "never silently evaluate two models using different prompts".
    prompt_hash = components["prompt_renderer"].prompt_hash

    runs_root = runs_root or paths["runs"]
    batch_id = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}_batch"
    batch_dir = os.path.join(runs_root, batch_id)
    os.makedirs(batch_dir, exist_ok=True)

    results: Dict[str, Dict[str, Any]] = {}
    skipped: Dict[str, str] = {}

    for model_key in model_keys:
        try:
            config = registry.get(model_key)
        except ConfigError as exc:
            skipped[model_key] = str(exc)
            continue

        if not config.enabled:
            skipped[model_key] = "disabled in configs/models.yaml"
            continue

        if not config.credentials_available():
            # Skipped, not failed: the rest of the batch is still valid, and
            # the report records that this model was configured but unrunnable.
            skipped[model_key] = (
                f"no credentials in ${config.api_key_env}"
                if config.api_key_env
                else "no credentials configured"
            )
            continue

        results[model_key] = run_model(
            model_key=model_key,
            paths=paths,
            strict=strict,
            resume=resume,
            max_records=max_records,
            components=components,
            prompt_hash_override=prompt_hash,
            client=client,
            quiet=quiet,
        )

    if not results:
        raise ConfigError(
            "No runnable models. Skipped: "
            + "; ".join(f"{key} ({reason})" for key, reason in skipped.items())
        )

    validator = components["validator"]
    dataset_kind = classify_dataset_kind(paths["dataset"])

    comparison = compare_models(
        results,
        fields=validator.fields,
        critical_fields=validator.critical_fields,
    )

    report = build_report(
        results_by_model=results,
        comparison=comparison,
        dataset_kind=dataset_kind,
        run_metadata={
            "batch_id": batch_id,
            "prompt_sha256": prompt_hash,
            "prompt_name": PROMPT_NAME,
            "prompt_version": PROMPT_VERSION,
            "models_config_sha256": compute_file_hash(paths["models"]),
            "pricing_config_sha256": (
                compute_file_hash(paths["pricing"]) if os.path.exists(paths["pricing"]) else None
            ),
            "model_config_hashes": {
                key: registry.get(key).config_hash for key in results
            },
        },
        skipped_models=skipped,
    )

    write_report_json(report, os.path.join(batch_dir, "benchmark_report.json"))
    write_report_csv(report, os.path.join(batch_dir, "benchmark_report.csv"))
    write_report_markdown(report, os.path.join(batch_dir, "benchmark_report.md"))
    write_report_json(comparison, os.path.join(batch_dir, "model_comparison.json"))
    write_comparison_csv(comparison, os.path.join(batch_dir, "model_comparison.csv"))
    write_dashboard_csv(results, os.path.join(batch_dir, "dashboard_field_metrics.csv"))

    if review_sample:
        sample = _write_review_sample(
            results, paths, validator.critical_fields, comparison, review_sample, batch_dir
        )
        report["review_sample_size"] = len(sample)
        write_report_json(report, os.path.join(batch_dir, "benchmark_report.json"))

    if not quiet:
        _print_batch_summary(report, skipped)

    return {
        "batch_id": batch_id,
        "batch_dir": batch_dir,
        "results": results,
        "comparison": comparison,
        "report": report,
        "skipped": skipped,
    }


def _write_review_sample(results, paths, critical_fields, comparison, limit, batch_dir):
    import pandas as pd

    dataset_rows = pd.read_csv(paths["dataset"], dtype=str, keep_default_na=False).to_dict(
        orient="records"
    )
    texts = source_text_index(dataset_rows)

    disagreement_ids = {
        entry.split(":")[0]
        for entry in (comparison.get("agreement", {}).get("full_disagreement_slots") or [])
    }
    for pair in comparison.get("paired", []):
        disagreement_ids.update(pair.get("disagreement_ids") or [])

    sample = build_review_sample(
        results_by_model=results,
        source_texts=texts,
        critical_fields=critical_fields,
        limit=limit,
        disagreement_ids=disagreement_ids,
    )

    path = os.path.join(batch_dir, "review_sample.jsonl")
    with open(path, "w", encoding="utf-8") as handle:
        for row in sample:
            handle.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")

    return sample


# ----------------------------------------------------------------------
# v2.0.4 compatible entry point
# ----------------------------------------------------------------------


def run(
    paths: Optional[Dict[str, str]] = None,
    run_dir: Optional[str] = None,
    strict: bool = True,
) -> Dict[str, Any]:
    """Single-model run with the v2.0.4 signature and output shape."""
    return run_model(model_key="mock", paths=paths, run_dir=run_dir, strict=strict)


# ----------------------------------------------------------------------
# Printing
# ----------------------------------------------------------------------


def _print_summary(results: Dict[str, Any]) -> None:
    headline = results["headline"]
    operations = results.get("operations") or {}
    run_block = results.get("run") or {}
    intervals = results.get("confidence_intervals", {}).get("accuracy", {})

    print()
    print("=" * 70)
    print(f"BENCHMARK RESULTS — {run_block.get('model_key')} [{run_block.get('result_class')}]")
    print("=" * 70)
    print(f"run id                : {run_block.get('run_id')}")
    print(f"records               : {results['total_records']}")

    if intervals.get("low") is not None:
        print(
            f"accuracy (final)      : {headline['micro_accuracy'] * 100:.2f}% "
            f"[{intervals['low'] * 100:.2f}–{intervals['high'] * 100:.2f}] 95% CI"
        )
    print(f"macro accuracy (final): {headline['macro_accuracy'] * 100:.2f}%")
    print(f"exact match           : {headline['exact_match'] * 100:.2f}%")
    print(f"critical exact match  : {headline['critical_exact_match'] * 100:.2f}%")
    print(f"macro F1              : {headline['macro_f1'] * 100:.2f}%")
    print(f"abstention rate       : {headline['abstention_rate'] * 100:.2f}%")
    print(f"selective accuracy    : {headline['selective_accuracy'] * 100:.2f}%")
    print(f"critical error rate   : {headline['critical_field_error_rate'] * 100:.2f}%")
    print(f"evidence support rate : {headline['evidence_support_rate'] * 100:.2f}%")

    cost = operations.get("total_cost")
    print(f"total cost            : {'null (unpriced)' if cost is None else cost}")
    latency = operations.get("mean_latency_ms")
    print(f"mean latency          : {'—' if latency is None else f'{latency:.1f} ms'}")
    print(f"success rate          : {operations.get('success_rate', 0) * 100:.2f}%")
    print(f"determinism supported : {run_block.get('determinism_supported')}")
    print("=" * 70)


def _print_batch_summary(report: Dict[str, Any], skipped: Dict[str, str]) -> None:
    print()
    print("=" * 70)
    print(f"BATCH REPORT — {report.get('result_class')}")
    print("=" * 70)
    print(report.get("banner"))
    print("-" * 70)

    for row in report.get("summary_table", []):
        print(
            f"{row.get('model'):<22} acc={_fmt(row.get('accuracy'))} "
            f"exact={_fmt(row.get('exact_match'))} "
            f"crit={_fmt(row.get('critical_exact_match'))} "
            f"f1={_fmt(row.get('macro_f1'))}"
        )

    for key, reason in sorted(skipped.items()):
        print(f"{key:<22} SKIPPED — {reason}")
    print("=" * 70)


def _fmt(value: Optional[float]) -> str:
    return "  —   " if value is None else f"{value * 100:6.2f}%"


# ----------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(description="Run the abaya classification benchmark")
    parser.add_argument("--model", action="append", default=None,
                        help="Model key from configs/models.yaml (repeatable)")
    parser.add_argument("--all-models", action="store_true",
                        help="Run every enabled model that has credentials")
    parser.add_argument("--dataset", default=DEFAULTS["dataset"])
    parser.add_argument("--gold", default=DEFAULTS["gold"])
    parser.add_argument("--prompt", default=DEFAULTS["prompt"])
    parser.add_argument("--training", default=DEFAULTS["training"])
    parser.add_argument("--manifest", default=DEFAULTS["manifest"])
    parser.add_argument("--models-config", dest="models", default=DEFAULTS["models"])
    parser.add_argument("--pricing", default=DEFAULTS["pricing"])
    parser.add_argument("--model-config", dest="model_config", default=DEFAULTS["model_config"])
    parser.add_argument("--run-id", dest="run_id", default=None)
    parser.add_argument("--run-dir", dest="run_dir", default=None)
    parser.add_argument("--resume", action="store_true",
                        help="Continue the latest run for this model, refusing on any config drift")
    parser.add_argument("--review-sample", dest="review_sample", type=int, default=None,
                        help="Write N records for human review")
    parser.add_argument("--max-records", dest="max_records", type=int, default=None)
    parser.add_argument("--dry-run", dest="dry_run", action="store_true",
                        help="Validate everything and make zero model calls")
    parser.add_argument("--no-strict", action="store_true",
                        help="Report integrity failures without blocking (never for a release run)")
    args = parser.parse_args(argv)

    paths = {
        **DEFAULTS,
        "dataset": args.dataset,
        "gold": args.gold,
        "prompt": args.prompt,
        "training": args.training,
        "manifest": args.manifest,
        "models": args.models,
        "pricing": args.pricing,
        "model_config": args.model_config,
    }

    try:
        registry = ModelRegistry.from_yaml(paths["models"])

        if args.all_models:
            model_keys = [config.key for config in registry.runnable()]
            if not model_keys:
                print("❌ No models are both enabled and credentialed.", file=sys.stderr)
                return 4
        elif args.model:
            model_keys = list(args.model)
        else:
            model_keys = ["mock"]

        if args.dry_run:
            report = dry_run(model_keys, paths)
            _print_dry_run(report)
            return 0 if report["integrity"] != FAIL else 2

        if len(model_keys) > 1 or args.all_models:
            run_batch(
                model_keys,
                paths=paths,
                strict=not args.no_strict,
                resume=args.resume,
                max_records=args.max_records,
                review_sample=args.review_sample,
            )
        else:
            run_dir = args.run_dir
            if args.resume and not run_dir and not args.run_id:
                run_dir = find_latest_run(paths["runs"], model_keys[0])

            run_model(
                model_key=model_keys[0],
                paths=paths,
                run_dir=run_dir,
                run_id=args.run_id,
                strict=not args.no_strict,
                resume=args.resume,
                max_records=args.max_records,
            )

    except IntegrityError as exc:
        print(f"\n❌ INTEGRITY FAILURE: {exc}", file=sys.stderr)
        return 2
    except ConfigError as exc:
        print(f"\n❌ CONFIGURATION ERROR: {exc}", file=sys.stderr)
        return 3
    except ClassifierError as exc:
        print(f"\n❌ CLASSIFIER ERROR: {exc}", file=sys.stderr)
        return 5

    return 0


def _print_dry_run(report: Dict[str, Any]) -> None:
    print()
    print("=" * 70)
    print("DRY RUN — no model was called")
    print("=" * 70)
    print(f"Integrity            : {report['integrity']}")
    print(f"Configuration        : {report['configuration']}")
    print(f"Dataset              : {report['dataset']}")
    print(f"Gold                 : {report['gold']}")
    print(f"Prompt               : {report['prompt']} ({report['prompt_sha256'][:16]}…)")
    print(f"Model configuration  : {report['model_configuration']}")
    print(f"Dataset kind         : {report['dataset_kind']}")
    print(f"API call count       : {report['api_call_count']}")
    print("-" * 70)

    for key, entry in sorted(report["models"].items()):
        if entry is None:
            print(f"{key:<22} NOT CONFIGURED")
            continue
        ready = "READY" if entry["enabled"] and entry["credentials_available"] else "NOT READY"
        detail = []
        if not entry["enabled"]:
            detail.append("disabled")
        if entry["requires_credentials"] and not entry["credentials_available"]:
            detail.append(f"needs ${entry['api_key_env']}")
        print(
            f"{key:<22} {ready:<10} {entry['provider']}/{entry['model'] or '-'}"
            + (f"  ({', '.join(detail)})" if detail else "")
        )
    print("=" * 70)


if __name__ == "__main__":
    raise SystemExit(main())
