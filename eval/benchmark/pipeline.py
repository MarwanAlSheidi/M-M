"""The pipeline: dataset in, four layers of prediction out.

Layer discipline is the point of this module. The classifier's output is
written down once and never mutated; validation, canonicalization and the final
scored value are each stored beside it. When a number looks wrong six months
later, the raw answer is still there to explain it.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import pandas as pd

from .auditor import Auditor
from .canonicalizer import Canonicalizer
from .classifier import BaseClassifier
from .cost_tracker import CostTracker
from .exceptions import IntegrityError
from .leakage_detector import LeakageDetector, normalize_id
from .prompt_renderer import PromptRenderer
from .utils import safe_str
from .validator import Validator

DATASET_REQUIRED_COLUMNS = ("product_id", "product_name_raw", "description_raw")

_MAX_REPORTED_IDS = 20


class Pipeline:
    """Runs classification and assembles the auditable prediction record."""

    def __init__(
        self,
        run_dir: str,
        validator: Validator,
        canonicalizer: Canonicalizer,
        prompt_renderer: PromptRenderer,
        classifier: BaseClassifier,
        cost_tracker: Optional[CostTracker] = None,
        leakage_detector: Optional[LeakageDetector] = None,
        auditor: Optional[Auditor] = None,
    ) -> None:
        self.run_dir = run_dir
        os.makedirs(run_dir, exist_ok=True)

        self.auditor = auditor or Auditor(run_dir)
        self.prompt_renderer = prompt_renderer
        self.validator = validator
        self.canonicalizer = canonicalizer
        self.classifier = classifier
        self.cost_tracker = cost_tracker or CostTracker()
        self.leakage_detector = leakage_detector or LeakageDetector()

        self.dataset_df: Optional[pd.DataFrame] = None
        self.gold_df: Optional[pd.DataFrame] = None
        self.gold_lookup: Dict[str, Dict[str, Any]] = {}

        self.predictions_raw: List[Dict[str, Any]] = []
        self.predictions_validated: List[Dict[str, Any]] = []
        self.predictions_final: List[Dict[str, Any]] = []

        # v2.0.5: set by the runner to skip records an interrupted run already
        # completed. Empty means classify everything.
        self.completed_ids: set = set()
        self.on_record_complete = None
        self.skipped_completed = 0

    # ------------------------------------------------------------------
    # loading
    # ------------------------------------------------------------------

    def load_dataset(self, dataset_path: str) -> pd.DataFrame:
        """Read the dataset and reject a bad schema immediately."""
        if not os.path.exists(dataset_path):
            raise IntegrityError(f"Dataset not found: {dataset_path}")

        frame = pd.read_csv(dataset_path, dtype=str, keep_default_na=False)

        missing = [c for c in DATASET_REQUIRED_COLUMNS if c not in frame.columns]
        if missing:
            raise IntegrityError(
                f"Dataset {dataset_path} is missing required columns: {', '.join(missing)}"
            )

        if frame.empty:
            raise IntegrityError(f"Dataset {dataset_path} contains no records")

        frame["product_id"] = frame["product_id"].astype(str).str.strip()
        self.dataset_df = frame

        self.auditor.log_event(
            "dataset_loaded",
            {"path": dataset_path, "records": len(frame), "columns": list(frame.columns)},
        )
        return frame

    def load_gold(self, gold_path: str) -> pd.DataFrame:
        """Read gold and build the normalized product_id lookup."""
        if not os.path.exists(gold_path):
            raise IntegrityError(f"Gold not found: {gold_path}")

        frame = pd.read_csv(gold_path, dtype=str, keep_default_na=False)

        if "product_id" not in frame.columns:
            raise IntegrityError(f"Gold {gold_path} has no 'product_id' column")

        if frame.empty:
            raise IntegrityError(f"Gold {gold_path} contains no records")

        frame["product_id"] = frame["product_id"].astype(str).str.strip()
        self.gold_df = frame

        self.gold_lookup = {}
        for row in frame.to_dict(orient="records"):
            self.gold_lookup[normalize_id(row["product_id"])] = row

        self.auditor.log_event(
            "gold_loaded",
            {"path": gold_path, "records": len(frame), "lookup_size": len(self.gold_lookup)},
        )
        return frame

    # ------------------------------------------------------------------
    # pre-flight
    # ------------------------------------------------------------------

    def _assert_alignment(self) -> None:
        """Dataset and gold must describe exactly the same records."""
        if self.dataset_df is None:
            raise IntegrityError("Dataset must be loaded before classification")
        if self.gold_df is None:
            raise IntegrityError("Gold must be loaded before classification")

        dataset_ids = self.dataset_df["product_id"].astype(str).str.strip()
        gold_ids = self.gold_df["product_id"].astype(str).str.strip()

        empty_dataset = int((dataset_ids == "").sum())
        empty_gold = int((gold_ids == "").sum())
        if empty_dataset or empty_gold:
            raise IntegrityError(
                f"Empty product_id present — dataset: {empty_dataset}, gold: {empty_gold}"
            )

        dataset_dupes = sorted(dataset_ids[dataset_ids.duplicated()].unique())
        gold_dupes = sorted(gold_ids[gold_ids.duplicated()].unique())
        if dataset_dupes or gold_dupes:
            raise IntegrityError(
                "Duplicate product_id blocks execution — "
                f"dataset: {dataset_dupes[:_MAX_REPORTED_IDS]}, "
                f"gold: {gold_dupes[:_MAX_REPORTED_IDS]}"
            )

        dataset_set = set(dataset_ids)
        gold_set = set(gold_ids)
        if dataset_set != gold_set:
            dataset_only = sorted(dataset_set - gold_set)[:_MAX_REPORTED_IDS]
            gold_only = sorted(gold_set - dataset_set)[:_MAX_REPORTED_IDS]
            raise IntegrityError(
                "Dataset and Gold describe different records — "
                f"dataset-only: {dataset_only}, gold-only: {gold_only}"
            )

    # ------------------------------------------------------------------
    # classification
    # ------------------------------------------------------------------

    def run_classification(self) -> List[Dict[str, Any]]:
        """Classify every record and build all four prediction layers."""
        self._assert_alignment()

        prompt = self.prompt_renderer.render()
        prompt_hash = self.prompt_renderer.prompt_hash
        self.auditor.log_event(
            "prompt_rendered",
            {"prompt_sha256": prompt_hash, "characters": len(prompt)},
        )

        if self.leakage_detector.is_active:
            # Layer 1 re-run against the frames actually loaded, not the paths
            # the gate saw. Between the two, files can be swapped.
            self.leakage_detector.check_ids(
                self.dataset_df["product_id"].tolist(), "dataset"
            )
            self.leakage_detector.check_ids(self.gold_df["product_id"].tolist(), "gold")
            self.auditor.log_event("leakage_precheck_passed", self.leakage_detector.summary())

        # A resumed run keeps the records it already paid for; only the
        # remainder is reclassified. Restored records are loaded by the runner
        # into these lists before run_classification is called.
        already_done = set(self.completed_ids)
        if not already_done:
            self.predictions_raw = []
            self.predictions_validated = []
            self.predictions_final = []
        self.skipped_completed = 0

        for row in self.dataset_df.to_dict(orient="records"):
            product_id = normalize_id(row.get("product_id"))
            source_text = self._build_source_text(row)

            # Layer 2: per record, every record, no exceptions. Runs even for
            # records restored from a checkpoint — a leaked record must not
            # survive into a resumed run just because it was cheap to keep.
            self.leakage_detector.check_record(product_id, source_text)

            if product_id in already_done:
                self.skipped_completed += 1
                continue

            raw_output = self._invoke_classifier(row, product_id, source_text, prompt)
            error = raw_output.get("error")

            raw_record = {
                "product_id": product_id,
                "source_text": source_text,
                "prediction": raw_output.get("prediction") or {},
                "usage": raw_output.get("usage") or {},
                "raw_response": raw_output.get("raw_response"),
                "retry_log": raw_output.get("retry_log") or [],
                "error": error,
                # v2.0.5 operational fields. Absent on legacy classifiers,
                # which is why they are read with .get and default to None
                # rather than to a fabricated zero.
                "error_category": raw_output.get("error_category"),
                "latency_ms": raw_output.get("latency_ms"),
                "attempt_count": raw_output.get("attempt_count", 1),
                "retry_reason": raw_output.get("retry_reason") or [],
                "final_status": raw_output.get("final_status", "error" if error else "success"),
                "cost": raw_output.get("cost"),
                "currency": raw_output.get("currency"),
                "request_id": raw_output.get("request_id"),
                "provider": raw_output.get("provider"),
                "model": raw_output.get("model"),
            }
            self.predictions_raw.append(raw_record)

            if error:
                # A failed record is scored as an abstention, not dropped: it
                # must still depress recall rather than shrink the denominator.
                validated = self.validator.abstained_prediction(reason="classifier_error")
                self.auditor.log_event(
                    "classifier_error", {"product_id": product_id, "error": error}
                )
            else:
                validated = self.validator.validate_prediction(
                    raw_output.get("prediction") or {}, source_text=source_text
                )

            self.predictions_validated.append(
                {"product_id": product_id, "fields": validated, "error": error}
            )
            final_record = self._build_final_record(
                product_id=product_id,
                raw_prediction=raw_output.get("prediction") or {},
                validated=validated,
                error=error,
            )
            final_record["error_category"] = raw_output.get("error_category")
            self.predictions_final.append(final_record)

            self._track_call(product_id, raw_record)

            if callable(self.on_record_complete):
                # Checkpoint after each record so an interruption loses at most
                # the record in flight.
                self.on_record_complete(product_id, raw_record)

        self.auditor.log_event(
            "classification_complete",
            {
                "records": len(self.predictions_final),
                "errors": sum(1 for r in self.predictions_raw if r.get("error")),
            },
        )
        return self.predictions_final

    def _invoke_classifier(
        self,
        row: Dict[str, Any],
        product_id: str,
        source_text: str,
        prompt: str,
    ) -> Dict[str, Any]:
        """Call the classifier through whichever interface it declares.

        v2.0.5 providers take the record's fields; v2.0.4 classifiers take the
        pre-joined source text. Both remain supported so an existing classifier
        keeps working unchanged.
        """
        if getattr(self.classifier, "accepts_record_fields", False):
            return self.classifier.classify(
                product_name=row.get("product_name_raw"),
                description=row.get("description_raw"),
                system_prompt=prompt,
                product_id=product_id,
            )

        return self.classifier.classify(
            source_text=source_text, prompt=prompt, product_id=product_id
        )

    def _track_call(self, product_id: str, raw_record: Dict[str, Any]) -> None:
        """Hand the per-call operational facts to the cost tracker."""
        usage = raw_record.get("usage") or {}
        self.cost_tracker.add_call(
            product_id=product_id,
            latency_ms=raw_record.get("latency_ms"),
            cost=raw_record.get("cost"),
            currency=raw_record.get("currency"),
            input_tokens=usage.get("input_tokens", usage.get("prompt_tokens")),
            output_tokens=usage.get("output_tokens", usage.get("completion_tokens")),
            attempt_count=raw_record.get("attempt_count", 1),
            final_status=raw_record.get("final_status", "success"),
        )

    def restore_completed(
        self,
        raw_records: List[Dict[str, Any]],
        source_text_lookup: Optional[Dict[str, str]] = None,
    ) -> int:
        """Rebuild prediction layers for records a previous run completed.

        Revalidates rather than trusting the stored validated layer: validation
        is cheap and local, so a resumed run re-derives it from the raw answer
        under the *current* configuration. If that configuration had changed,
        the fingerprint check would already have refused the resume.
        """
        restored = 0
        for raw_record in raw_records:
            product_id = normalize_id(raw_record.get("product_id"))
            if not product_id:
                continue

            source_text = raw_record.get("source_text") or (
                (source_text_lookup or {}).get(product_id, "")
            )
            error = raw_record.get("error")

            self.predictions_raw.append(raw_record)

            if error:
                validated = self.validator.abstained_prediction(reason="classifier_error")
            else:
                validated = self.validator.validate_prediction(
                    raw_record.get("prediction") or {}, source_text=source_text
                )

            self.predictions_validated.append(
                {"product_id": product_id, "fields": validated, "error": error}
            )
            final_record = self._build_final_record(
                product_id=product_id,
                raw_prediction=raw_record.get("prediction") or {},
                validated=validated,
                error=error,
            )
            final_record["error_category"] = raw_record.get("error_category")
            self.predictions_final.append(final_record)

            self._track_call(product_id, raw_record)
            self.completed_ids.add(product_id)
            restored += 1

        self.auditor.log_event("resume_restored", {"records": restored})
        return restored

    @staticmethod
    def _build_source_text(row: Dict[str, Any]) -> str:
        name = safe_str(row.get("product_name_raw")).strip()
        description = safe_str(row.get("description_raw")).strip()
        return f"اسم المنتج: {name}\nالوصف: {description}"

    def _build_final_record(
        self,
        product_id: str,
        raw_prediction: Dict[str, Any],
        validated: Dict[str, Dict[str, Any]],
        error: Optional[str],
    ) -> Dict[str, Any]:
        """Assemble the four-layer record the evaluator consumes."""
        record: Dict[str, Any] = {"product_id": product_id, "error": error}

        for field in self.validator.fields:
            entry = validated.get(field) or {}

            raw_entry = raw_prediction.get(field) if isinstance(raw_prediction, dict) else None
            raw_value = raw_entry.get("value") if isinstance(raw_entry, dict) else raw_entry

            decision = entry.get("decision")
            canonical = entry.get("canonical_value")

            # An abstention scores as "no answer" whatever the model typed.
            final_value = canonical if decision == "PREDICT" else None

            record[field] = {
                "raw": raw_value,
                "validated": entry.get("value") if entry.get("valid") else None,
                "confidence": entry.get("confidence"),
                "evidence": entry.get("evidence"),
                "evidence_status": entry.get("evidence_status"),
                "decision": decision,
                "canonical": canonical,
                "final": final_value,
                "reason": entry.get("reason"),
                "confidence_penalty": entry.get("confidence_penalty"),
            }

        return record

    # ------------------------------------------------------------------
    # cost
    # ------------------------------------------------------------------

    def record_costs(self, evaluation: Dict[str, Any]) -> Dict[str, Any]:
        """Join token usage to per-record correctness after evaluation.

        Runs after scoring because cost per *correct* record cannot be known
        until the record has been scored.
        """
        per_record = {
            result["product_id"]: result for result in evaluation.get("per_record", [])
        }

        for raw_record in self.predictions_raw:
            product_id = raw_record["product_id"]
            result = per_record.get(product_id)

            if result is None:
                field_correct: Dict[str, bool] = {}
                is_record_correct = False
                raw_exact_match = False
                is_critical_exact_match = False
            else:
                field_correct = {
                    field: bool(values.get("final_correct"))
                    for field, values in result.get("fields", {}).items()
                }
                is_record_correct = bool(result.get("exact_match"))
                raw_exact_match = bool(result.get("raw_exact_match"))
                is_critical_exact_match = bool(result.get("critical_exact_match"))

            self.cost_tracker.add_usage(
                raw_record.get("usage", {}),
                product_id,
                field_correct,
                is_record_correct,
                raw_exact_match,
                is_critical_exact_match,
            )

        summary = self.cost_tracker.summary()
        self.auditor.log_event("cost_summary", summary)
        return summary

    # ------------------------------------------------------------------
    # persistence
    # ------------------------------------------------------------------

    def save_predictions(self) -> Dict[str, str]:
        """Write all three JSONL artefacts and return their paths."""
        paths = {
            "predictions_raw": self.auditor.save_jsonl(
                "predictions_raw.jsonl", self.predictions_raw
            ),
            "predictions_validated": self.auditor.save_jsonl(
                "predictions_validated.jsonl", self.predictions_validated
            ),
            "predictions_final": self.auditor.save_jsonl(
                "predictions_final.jsonl", self.predictions_final
            ),
        }
        self.auditor.log_event("predictions_saved", paths)
        return paths
