"""Report generation.

One rule dominates this module: a report built from the synthetic fixture must
never be readable as a model benchmark. Every artefact carries
``dataset_kind``, and the fixture case gets an explicit banner rather than a
quiet field somebody has to notice.

Output is deliberately shallow. A dashboard, a spreadsheet or a notebook should
be able to read the summary table without reshaping nested JSON, so the flat
rows are the primary surface and the nested document is the archive.
"""

from __future__ import annotations

import csv
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

from .comparison import COMPARISON_COLUMNS
from .dataset_manifest import FIXTURE, PRODUCTION
from .version import VERSION

FIXTURE_BANNER = (
    "TEST FIXTURE RESULTS — synthetic data and/or offline mock models. "
    "These numbers describe the harness, not any model's real accuracy. "
    "Do not publish, quote or compare them as a model benchmark."
)

PRODUCTION_BANNER = (
    "REAL BENCHMARK RESULTS — production dataset with live provider models."
)


def result_label(
    dataset_kind: str,
    providers: Sequence[str],
    integrity_passed: bool = True,
) -> Dict[str, Any]:
    """Classify a set of results as fixture or real, and say why.

    Real requires all three: a production dataset, at least one live provider,
    and an integrity gate that passed. A real dataset scored by the mock is a
    fixture result; a live model over the synthetic dataset is too; and a run
    that only completed because the gate was bypassed (``--no-strict``) can
    never claim to be a benchmark of anything, because nothing verified what it
    measured.
    """
    live_providers = sorted({p for p in providers if p and p != "local"})
    is_production_data = dataset_kind == PRODUCTION
    is_real = is_production_data and bool(live_providers) and integrity_passed

    if is_real:
        reason = f"production dataset, live providers: {', '.join(live_providers)}"
    elif is_production_data and live_providers and not integrity_passed:
        reason = "integrity gate did not pass; results cannot be attributed to a known artefact"
    elif not is_production_data and not live_providers:
        reason = "fixture dataset and offline mock models"
    elif not is_production_data:
        reason = "fixture dataset (models were live, data was not)"
    else:
        reason = "production dataset scored by offline mock models only"

    return {
        "result_class": "REAL_BENCHMARK" if is_real else "TEST_FIXTURE",
        "banner": PRODUCTION_BANNER if is_real else FIXTURE_BANNER,
        "dataset_kind": dataset_kind,
        "live_providers": live_providers,
        "integrity_passed": bool(integrity_passed),
        "reason": reason,
    }


def build_report(
    results_by_model: Dict[str, Dict[str, Any]],
    comparison: Optional[Dict[str, Any]] = None,
    dataset_kind: str = FIXTURE,
    run_metadata: Optional[Dict[str, Any]] = None,
    skipped_models: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Assemble the full benchmark report document."""
    providers = [
        result.get("run", {}).get("provider") for result in results_by_model.values()
    ]
    # A batch is only "real" if every run in it passed its gate.
    integrity_passed = all(
        (result.get("run", {}).get("integrity", {}) or {}).get("overall") == "PASS"
        for result in results_by_model.values()
    )
    label = result_label(dataset_kind, providers, integrity_passed=integrity_passed)

    rows = (comparison or {}).get("rows") or []

    return {
        "benchmark_version": VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "result_class": label["result_class"],
        "banner": label["banner"],
        "classification_reason": label["reason"],
        "dataset_kind": dataset_kind,
        "integrity_passed": label["integrity_passed"],
        "models": sorted(results_by_model),
        "skipped_models": dict(skipped_models or {}),
        "summary_table": rows,
        "comparison": comparison or {},
        "per_model": {
            key: {
                "run": result.get("run", {}),
                "headline": result.get("headline", {}),
                "levels": result.get("levels", {}),
                "selective": result.get("selective", {}),
                "evidence": result.get("evidence", {}),
                "critical": result.get("critical", {}),
                "cost": result.get("cost", {}),
                "operations": result.get("operations", {}),
                "error_analysis": result.get("error_analysis", {}),
                "confidence_intervals": result.get("confidence_intervals", {}),
            }
            for key, result in results_by_model.items()
        },
        "run_metadata": run_metadata or {},
        "caveats": [
            label["banner"],
            "Confidence intervals are Wilson score intervals at 95%. "
            "Overlap between two intervals is not a significance test.",
            "Paired McNemar results describe these records under this prompt, "
            "not a general ranking of the models.",
            "Agreement between models measures consistency, never correctness.",
            "Costs are null where pricing or provider token usage was unavailable; "
            "a null cost is not a zero cost.",
        ],
    }


def write_report_json(report: Dict[str, Any], path: str) -> str:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, ensure_ascii=False, allow_nan=False, default=str)
    return path


def write_report_csv(report: Dict[str, Any], path: str) -> str:
    """Flat one-row-per-model CSV, with the fixture/real label on every row.

    The label is repeated per row on purpose: a CSV gets filtered, sorted and
    pasted into decks, and a banner that lives only in a header does not
    survive that.
    """
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    columns = ["result_class", *COMPARISON_COLUMNS]

    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in report.get("summary_table", []):
            record = {column: row.get(column) for column in COMPARISON_COLUMNS}
            record["result_class"] = report.get("result_class")
            writer.writerow(record)

    return path


def write_report_markdown(report: Dict[str, Any], path: str) -> str:
    """Human-readable summary. The banner is the first thing on the page."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)

    lines: List[str] = []
    lines.append(f"# Benchmark Report — v{report.get('benchmark_version')}")
    lines.append("")
    lines.append(f"> **{report.get('result_class')}**")
    lines.append(f"> {report.get('banner')}")
    lines.append("")
    lines.append(f"- Generated: `{report.get('generated_at')}`")
    lines.append(f"- Dataset kind: `{report.get('dataset_kind')}`")
    lines.append(f"- Classification: {report.get('classification_reason')}")
    lines.append(f"- Models: {', '.join(report.get('models') or []) or 'none'}")

    skipped = report.get("skipped_models") or {}
    if skipped:
        lines.append("")
        lines.append("## Skipped models")
        lines.append("")
        for key, reason in sorted(skipped.items()):
            lines.append(f"- `{key}` — {reason}")

    rows = report.get("summary_table") or []
    if rows:
        lines.append("")
        lines.append("## Summary")
        lines.append("")
        lines.append(
            "| model | accuracy (95% CI) | exact match | critical exact | macro F1 | "
            "abstention | cost | mean latency | success |"
        )
        lines.append("|---|---|---|---|---|---|---|---|---|")

        for row in rows:
            ci_low = row.get("accuracy_ci_low")
            ci_high = row.get("accuracy_ci_high")
            ci = (
                f"{_pct(row.get('accuracy'))} [{_pct(ci_low)}–{_pct(ci_high)}]"
                if ci_low is not None
                else _pct(row.get("accuracy"))
            )
            cost = row.get("total_cost")
            cost_text = "null" if cost is None else f"{cost:.6f} {row.get('currency') or ''}".strip()
            latency = row.get("mean_latency_ms")

            lines.append(
                f"| `{row.get('model')}` | {ci} | {_pct(row.get('exact_match'))} | "
                f"{_pct(row.get('critical_exact_match'))} | {_pct(row.get('macro_f1'))} | "
                f"{_pct(row.get('abstention_rate'))} | {cost_text} | "
                f"{'—' if latency is None else f'{latency:.1f} ms'} | "
                f"{_pct(row.get('success_rate'))} |"
            )

    paired = (report.get("comparison") or {}).get("paired") or []
    if paired:
        lines.append("")
        lines.append("## Paired comparison (McNemar)")
        lines.append("")
        lines.append("| A | B | A wins | B wins | discordant | method | p |")
        lines.append("|---|---|---|---|---|---|---|")
        for pair in paired:
            test = pair.get("mcnemar", {})
            lines.append(
                f"| `{pair.get('model_a')}` | `{pair.get('model_b')}` | "
                f"{pair.get('a_wins')} | {pair.get('b_wins')} | "
                f"{test.get('discordant_pairs')} | {test.get('method')} | "
                f"{test.get('p_value')} |"
            )

    lines.append("")
    lines.append("## Caveats")
    lines.append("")
    for caveat in report.get("caveats", []):
        lines.append(f"- {caveat}")
    lines.append("")

    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))

    return path


def _pct(value: Optional[float]) -> str:
    if value is None:
        return "—"
    return f"{value * 100:.2f}%"


def flatten_for_dashboard(results_by_model: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """One flat row per (model, field), ready for a pivot table or a chart.

    Deliberately denormalized: repeating the model-level columns on every row
    is what lets a dashboard group by either axis without a join.
    """
    rows: List[Dict[str, Any]] = []

    for model_key, result in sorted(results_by_model.items()):
        run = result.get("run", {})
        final = result.get("levels", {}).get("final", {})

        for field, metrics in (final.get("field_metrics") or {}).items():
            rows.append(
                {
                    "model": model_key,
                    "provider": run.get("provider"),
                    "model_id": run.get("model_id"),
                    "dataset_kind": run.get("dataset_kind"),
                    "result_class": run.get("result_class"),
                    "field": field,
                    "is_critical": metrics.get("is_critical"),
                    "accuracy": metrics.get("accuracy"),
                    "precision": metrics.get("precision"),
                    "recall": metrics.get("recall"),
                    "f1": metrics.get("f1"),
                    "correct": metrics.get("correct"),
                    "errors": metrics.get("errors"),
                    "total": metrics.get("total"),
                    "abstention_rate": result.get("per_field_operations", {})
                    .get(field, {})
                    .get("abstention_rate"),
                    "evidence_support_rate": result.get("per_field_operations", {})
                    .get(field, {})
                    .get("evidence_support_rate"),
                }
            )

    return rows


def write_dashboard_csv(results_by_model: Dict[str, Dict[str, Any]], path: str) -> str:
    rows = flatten_for_dashboard(results_by_model)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)

    columns = [
        "model", "provider", "model_id", "dataset_kind", "result_class", "field",
        "is_critical", "accuracy", "precision", "recall", "f1", "correct", "errors",
        "total", "abstention_rate", "evidence_support_rate",
    ]

    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column) for column in columns})

    return path


def write_confusion_csv(result: Dict[str, Any], path: str) -> str:
    """Long-format confusion matrix CSV: model, field, gold, predicted, count."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    model_key = result.get("run", {}).get("model_key", "unknown")
    field_metrics = result.get("levels", {}).get("final", {}).get("field_metrics", {})

    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["model", "field", "gold", "predicted", "count"])

        for field, metrics in sorted(field_metrics.items()):
            for key, count in sorted((metrics.get("confusion_matrix") or {}).items()):
                gold, _, predicted = key.partition(" -> ")
                writer.writerow([model_key, field, gold, predicted, count])

    return path
