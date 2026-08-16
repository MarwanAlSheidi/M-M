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

        self.predictions_raw = []
        self.predictions_validated = []
        self.predictions_final = []

        for row in self.dataset_df.to_dict(orient="records"):
            product_id = normalize_id(row.get("product_id"))
            source_text = self._build_source_text(row)

            # Layer 2: per record, every record, no exceptions.
            self.leakage_detector.check_record(product_id, source_text)

            raw_output = self.classifier.classify(
                source_text=source_text, prompt=prompt, product_id=product_id
            )
            error = raw_output.get("error")

            raw_record = {
                "product_id": product_id,
                "source_text": source_text,
                "prediction": raw_output.get("prediction") or {},
                "usage": raw_output.get("usage") or {},
                "raw_response": raw_output.get("raw_response"),
                "retry_log": raw_output.get("retry_log") or [],
                "error": error,
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
            self.predictions_final.append(
                self._build_final_record(
                    product_id=product_id,
                    raw_prediction=raw_output.get("prediction") or {},
                    validated=validated,
                    error=error,
                )
            )

        self.auditor.log_event(
            "classification_complete",
            {
                "records": len(self.predictions_final),
                "errors": sum(1 for r in self.predictions_raw if r.get("error")),
            },
        )
        return self.predictions_final

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
