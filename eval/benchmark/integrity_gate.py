"""The integrity gate: everything that must be true before a run may start.

The gate answers one question — *can this run's numbers be attributed to a
known artefact?* If gold has been edited, if the dataset and gold describe
different record sets, if training data has bled into evaluation, then the run
would produce numbers about something nobody can name. Those are FAIL, and FAIL
stops execution.

Statuses:

``PASS``  verified
``FAIL``  blocks the run
``WARN``  worth knowing, does not block (missing optional artefact)
``INFO``  informational only
"""

from __future__ import annotations

import importlib
import json
import os
from typing import Any, Dict, List, Optional, Sequence

import pandas as pd

from .exceptions import ConfigError
from .utils import compute_dict_hash, compute_file_hash, safe_str

PASS = "PASS"
FAIL = "FAIL"
WARN = "WARN"
INFO = "INFO"

# Modules whose hashes the manifest may pin. Absence of a hash is a WARN;
# a mismatch is a FAIL.
CODE_FILES = (
    "utils.py",
    "evaluator.py",
    "validator.py",
    "canonicalizer.py",
    "evidence_verifier.py",
    "leakage_detector.py",
    "pipeline.py",
    "integrity_gate.py",
    "auditor.py",
    "run_benchmark.py",
)

# Files the current architecture cannot run without. A missing one of these is
# a FAIL even though a missing optional module is only a WARN.
REQUIRED_CODE_FILES = frozenset(
    {
        "utils.py",
        "evaluator.py",
        "validator.py",
        "canonicalizer.py",
        "pipeline.py",
        "integrity_gate.py",
    }
)

_MAX_REPORTED_IDS = 20


class IntegrityGate:
    """Runs every pre-flight check and reports a single overall verdict."""

    def __init__(
        self,
        manifest_path: str,
        gold_path: str,
        dataset_path: str,
        taxonomy_path: Optional[str] = None,
        synonyms_path: Optional[str] = None,
        critical_fields_path: Optional[str] = None,
        training_data_path: Optional[str] = None,
        code_dir: Optional[str] = None,
    ) -> None:
        self.manifest_path = manifest_path
        self.gold_path = gold_path
        self.dataset_path = dataset_path
        self.taxonomy_path = taxonomy_path
        self.synonyms_path = synonyms_path
        self.critical_fields_path = critical_fields_path
        self.training_data_path = training_data_path
        self.code_dir = code_dir or os.path.dirname(os.path.abspath(__file__))

        self.checks: List[Dict[str, Any]] = []
        self.result: Dict[str, Any] = {}
        self.manifest: Dict[str, Any] = self._load_manifest(manifest_path)

    # ------------------------------------------------------------------
    # plumbing
    # ------------------------------------------------------------------

    @staticmethod
    def _load_manifest(path: str) -> Dict[str, Any]:
        if not path or not os.path.exists(path):
            return {}
        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except json.JSONDecodeError as exc:
            raise ConfigError(f"Malformed manifest JSON at {path}: {exc}") from exc
        if not isinstance(data, dict):
            raise ConfigError("Manifest must be a JSON object")
        return data

    def _record(
        self,
        name: str,
        status: str,
        message: str,
        details: Optional[Sequence[str]] = None,
    ) -> Dict[str, Any]:
        check = {
            "name": name,
            "status": status,
            "message": message,
            "details": list(details or []),
        }
        self.checks.append(check)
        return check

    def _check_hash(
        self,
        name: str,
        path: Optional[str],
        manifest_key: str,
        label: str,
    ) -> Dict[str, Any]:
        """Shared file-hash comparison used by gold/taxonomy/synonyms/fields."""
        if not path:
            return self._record(name, WARN, f"{label} path not configured")

        if not os.path.exists(path):
            return self._record(name, FAIL, f"{label} file not found: {path}")

        expected = self.manifest.get(manifest_key)
        actual = compute_file_hash(path)

        if not expected:
            return self._record(
                name,
                WARN,
                f"Manifest has no {manifest_key}; {label} hash unverified",
                [f"actual: {actual}"],
            )

        if expected != actual:
            return self._record(
                name,
                FAIL,
                f"{label} hash mismatch — the file changed since the manifest was built",
                [f"expected: {expected}", f"actual:   {actual}"],
            )

        return self._record(name, PASS, f"{label} hash verified", [f"sha256: {actual}"])

    @staticmethod
    def _read_ids(path: str, column: str = "product_id") -> pd.Series:
        """Read an ID column as normalized strings.

        ``dtype=str`` plus ``keep_default_na=False`` stops pandas turning an ID
        of "NA" into a null and a numeric ID into a float that stringifies as
        "1.0" — either would silently break set comparison.
        """
        frame = pd.read_csv(path, dtype=str, keep_default_na=False)
        if column not in frame.columns:
            raise ConfigError(f"{path} has no '{column}' column")
        return frame[column].astype(str).str.strip()

    # ------------------------------------------------------------------
    # A. gold hash
    # ------------------------------------------------------------------

    def check_gold(self, gold_path: Optional[str] = None, manifest_path: Optional[str] = None):
        gold_path = gold_path or self.gold_path
        manifest_path = manifest_path or self.manifest_path

        if not os.path.exists(gold_path):
            return self._record("gold_file", FAIL, f"Gold file not found: {gold_path}")

        if not manifest_path or not os.path.exists(manifest_path):
            return self._record(
                "gold_file", FAIL, f"Manifest not found: {manifest_path}"
            )

        return self._check_hash("gold_file", gold_path, "gold_sha256", "Gold")

    # ------------------------------------------------------------------
    # B / C. schemas
    # ------------------------------------------------------------------

    def check_dataset_schema(self, dataset_path: Optional[str] = None):
        dataset_path = dataset_path or self.dataset_path
        required = ["product_id", "product_name_raw", "description_raw"]

        if not os.path.exists(dataset_path):
            return self._record(
                "dataset_schema", FAIL, f"Dataset not found: {dataset_path}"
            )

        columns = pd.read_csv(dataset_path, nrows=0).columns.tolist()
        missing = [column for column in required if column not in columns]

        if missing:
            return self._record(
                "dataset_schema",
                FAIL,
                "Dataset is missing required columns",
                [f"missing: {', '.join(missing)}"],
            )

        return self._record(
            "dataset_schema", PASS, f"Dataset schema valid ({len(columns)} columns)"
        )

    def check_gold_schema(self, gold_path: Optional[str] = None, taxonomy: Optional[Dict] = None):
        gold_path = gold_path or self.gold_path

        if not os.path.exists(gold_path):
            return self._record("gold_schema", FAIL, f"Gold not found: {gold_path}")

        columns = pd.read_csv(gold_path, nrows=0).columns.tolist()
        required = ["product_id"] + list((taxonomy or {}).keys())
        missing = [column for column in required if column not in columns]

        if missing:
            return self._record(
                "gold_schema",
                FAIL,
                "Gold is missing required columns",
                [f"missing: {', '.join(missing)}"],
            )

        return self._record(
            "gold_schema", PASS, f"Gold schema valid ({len(required)} required columns present)"
        )

    # ------------------------------------------------------------------
    # D. dataset/gold alignment — the critical one
    # ------------------------------------------------------------------

    def check_dataset_gold_alignment(
        self,
        dataset_path: Optional[str] = None,
        gold_path: Optional[str] = None,
    ):
        dataset_path = dataset_path or self.dataset_path
        gold_path = gold_path or self.gold_path

        for path, label in ((dataset_path, "Dataset"), (gold_path, "Gold")):
            if not os.path.exists(path):
                return self._record(
                    "dataset_gold_alignment", FAIL, f"{label} not found: {path}"
                )

        try:
            dataset_ids = self._read_ids(dataset_path)
            gold_ids = self._read_ids(gold_path)
        except ConfigError as exc:
            return self._record("dataset_gold_alignment", FAIL, str(exc))

        details: List[str] = []
        failed = False

        empty_dataset = int((dataset_ids == "").sum())
        empty_gold = int((gold_ids == "").sum())
        if empty_dataset or empty_gold:
            failed = True
            details.append(
                f"empty product_id — dataset: {empty_dataset}, gold: {empty_gold}"
            )

        dataset_valid = dataset_ids[dataset_ids != ""]
        gold_valid = gold_ids[gold_ids != ""]

        if dataset_valid.empty or gold_valid.empty:
            return self._record(
                "dataset_gold_alignment",
                FAIL,
                "Dataset or Gold contains no valid product_id",
                details
                + [
                    f"dataset valid ids: {len(dataset_valid)}",
                    f"gold valid ids: {len(gold_valid)}",
                ],
            )

        dataset_dupes = sorted(dataset_valid[dataset_valid.duplicated()].unique())
        gold_dupes = sorted(gold_valid[gold_valid.duplicated()].unique())

        if dataset_dupes:
            failed = True
            details.append(
                f"duplicate dataset ids ({len(dataset_dupes)}): "
                + ", ".join(dataset_dupes[:_MAX_REPORTED_IDS])
            )
        if gold_dupes:
            failed = True
            details.append(
                f"duplicate gold ids ({len(gold_dupes)}): "
                + ", ".join(gold_dupes[:_MAX_REPORTED_IDS])
            )

        dataset_set = set(dataset_valid)
        gold_set = set(gold_valid)

        dataset_only = sorted(dataset_set - gold_set)
        gold_only = sorted(gold_set - dataset_set)

        if dataset_only:
            failed = True
            details.append(
                f"in dataset but not gold ({len(dataset_only)}): "
                + ", ".join(dataset_only[:_MAX_REPORTED_IDS])
            )
        if gold_only:
            failed = True
            details.append(
                f"in gold but not dataset ({len(gold_only)}): "
                + ", ".join(gold_only[:_MAX_REPORTED_IDS])
            )

        if failed:
            return self._record(
                "dataset_gold_alignment",
                FAIL,
                "Dataset and Gold do not describe the same evaluation records",
                details,
            )

        return self._record(
            "dataset_gold_alignment",
            PASS,
            f"Dataset and Gold describe identical record sets ({len(dataset_set)} ids)",
        )

    # ------------------------------------------------------------------
    # E. leakage
    # ------------------------------------------------------------------

    def check_leakage(
        self,
        training_data_path: Optional[str] = None,
        gold_path: Optional[str] = None,
        dataset_path: Optional[str] = None,
    ):
        training_data_path = training_data_path or self.training_data_path
        gold_path = gold_path or self.gold_path
        dataset_path = dataset_path or self.dataset_path

        if not training_data_path or not os.path.exists(training_data_path):
            return self._record(
                "leakage",
                WARN,
                "No training file configured; leakage could not be checked",
                [f"path: {training_data_path}"] if training_data_path else [],
            )

        from .leakage_detector import load_training_ids  # local: avoids a cycle

        training_ids = load_training_ids(training_data_path)
        if not training_ids:
            return self._record(
                "leakage", WARN, f"Training file has no usable ids: {training_data_path}"
            )

        details: List[str] = []
        failed = False

        unchecked: List[str] = []

        for path, label in ((gold_path, "gold"), (dataset_path, "dataset")):
            if not path or not os.path.exists(path):
                unchecked.append(f"{label}: file not found ({path})")
                continue
            try:
                ids = set(self._read_ids(path))
            except ConfigError as exc:
                # Never skip silently: an unreadable side means leakage against
                # it is unknown, and unknown must not read as clean.
                unchecked.append(f"{label}: {exc}")
                continue

            overlap = sorted(training_ids & ids)
            if overlap:
                failed = True
                details.append(
                    f"training ∩ {label} = {len(overlap)}: "
                    + ", ".join(overlap[:_MAX_REPORTED_IDS])
                )

        if failed:
            return self._record(
                "leakage",
                FAIL,
                "Training data overlaps the evaluation set",
                details + unchecked,
            )

        if unchecked:
            return self._record(
                "leakage",
                WARN,
                "Leakage could not be checked against every evaluation file",
                unchecked,
            )

        return self._record(
            "leakage",
            PASS,
            f"No overlap between training ({len(training_ids)} ids) and evaluation",
        )

    # ------------------------------------------------------------------
    # F / G / H / I. config hashes
    # ------------------------------------------------------------------

    def check_taxonomy(self):
        return self._check_hash(
            "taxonomy", self.taxonomy_path, "taxonomy_sha256", "Taxonomy"
        )

    def check_synonyms(self):
        return self._check_hash(
            "synonyms", self.synonyms_path, "synonyms_sha256", "Synonyms"
        )

    def check_critical_fields(self):
        return self._check_hash(
            "critical_fields",
            self.critical_fields_path,
            "critical_fields_sha256",
            "Critical fields",
        )

    def check_prompt(self, prompt_hash: Optional[str]):
        expected = self.manifest.get("prompt_sha256")

        if not prompt_hash:
            return self._record("prompt", WARN, "No rendered prompt hash supplied")

        if not expected:
            return self._record(
                "prompt",
                WARN,
                "Manifest has no prompt_sha256; prompt unverified",
                [f"actual: {prompt_hash}"],
            )

        if expected != prompt_hash:
            return self._record(
                "prompt",
                FAIL,
                "Prompt hash mismatch — the rendered prompt changed",
                [f"expected: {expected}", f"actual:   {prompt_hash}"],
            )

        return self._record("prompt", PASS, "Prompt hash verified", [f"sha256: {prompt_hash}"])

    # ------------------------------------------------------------------
    # J. code hashes
    # ------------------------------------------------------------------

    def check_code_hashes(self, code_dir: Optional[str] = None):
        code_dir = code_dir or self.code_dir
        expected_all = self.manifest.get("code_hashes") or {}

        mismatches: List[str] = []
        missing_files: List[str] = []
        missing_hashes: List[str] = []
        verified = 0

        for filename in CODE_FILES:
            path = os.path.join(code_dir, filename)

            if not os.path.exists(path):
                if filename in REQUIRED_CODE_FILES:
                    mismatches.append(f"{filename}: required module is missing")
                else:
                    missing_files.append(filename)
                continue

            expected = expected_all.get(filename)
            actual = compute_file_hash(path)

            if not expected:
                missing_hashes.append(filename)
                continue

            if expected != actual:
                mismatches.append(f"{filename}: expected {expected[:12]}… got {actual[:12]}…")
            else:
                verified += 1

        if mismatches:
            return self._record(
                "code_hashes",
                FAIL,
                "Code integrity failed",
                mismatches,
            )

        details = []
        if missing_hashes:
            details.append("no manifest hash: " + ", ".join(missing_hashes))
        if missing_files:
            details.append("optional module absent: " + ", ".join(missing_files))

        if details:
            return self._record(
                "code_hashes",
                WARN,
                f"{verified} module hash(es) verified, some unverified",
                details,
            )

        return self._record("code_hashes", PASS, f"{verified} module hashes verified")

    # ------------------------------------------------------------------
    # K. model config
    # ------------------------------------------------------------------

    def check_model_config(self, model_config: Any):
        expected = self.manifest.get("model_config_sha256")

        if model_config is None:
            return self._record("model_config", WARN, "No model configuration supplied")

        if isinstance(model_config, str):
            if not os.path.exists(model_config):
                return self._record(
                    "model_config", FAIL, f"Model config file not found: {model_config}"
                )
            actual = compute_file_hash(model_config)
        elif isinstance(model_config, dict):
            actual = compute_dict_hash(model_config)
        else:
            return self._record(
                "model_config",
                FAIL,
                f"Unsupported model config type: {type(model_config).__name__}",
            )

        if not expected:
            return self._record(
                "model_config",
                WARN,
                "Manifest has no model_config_sha256; configuration unverified",
                [f"actual: {actual}"],
            )

        if expected != actual:
            return self._record(
                "model_config",
                FAIL,
                "Model config hash mismatch — the run is not comparable",
                [f"expected: {expected}", f"actual:   {actual}"],
            )

        return self._record("model_config", PASS, "Model config hash verified")

    # ------------------------------------------------------------------
    # L. evidence verification availability
    # ------------------------------------------------------------------

    def check_evidence_verification(self):
        policy = self.manifest.get("integrity_policy") or {}
        required = bool(policy.get("require_evidence_verification"))

        if not required:
            return self._record(
                "evidence_verification",
                INFO,
                "Evidence verification not required by manifest policy",
            )

        try:
            module = importlib.import_module(".evidence_verifier", package=__package__)
        except ImportError as exc:
            return self._record(
                "evidence_verification",
                FAIL,
                f"Policy requires evidence verification but the module will not import: {exc}",
            )

        if not hasattr(module, "EvidenceVerifier"):
            return self._record(
                "evidence_verification",
                FAIL,
                "evidence_verifier module has no EvidenceVerifier class",
            )

        return self._record(
            "evidence_verification", PASS, "EvidenceVerifier importable as required"
        )

    # ------------------------------------------------------------------
    # M. run
    # ------------------------------------------------------------------

    def run(
        self,
        taxonomy: Optional[Dict] = None,
        prompt_hash: Optional[str] = None,
        model_config: Any = None,
    ) -> Dict[str, Any]:
        """Run every check and return the verdict. Never raises on FAIL."""
        self.checks = []

        if not self.manifest:
            self._record(
                "manifest",
                FAIL,
                f"Manifest missing or empty: {self.manifest_path}",
            )
        else:
            self._record(
                "manifest",
                PASS,
                f"Manifest loaded ({len(self.manifest)} keys)",
                [f"version: {safe_str(self.manifest.get('version')) or 'unset'}"],
            )

        self.check_gold()
        self.check_dataset_schema()
        self.check_gold_schema(taxonomy=taxonomy)
        self.check_dataset_gold_alignment()
        self.check_leakage()
        self.check_taxonomy()
        self.check_synonyms()
        self.check_critical_fields()
        self.check_prompt(prompt_hash)
        self.check_code_hashes()
        self.check_model_config(model_config)
        self.check_evidence_verification()

        passed = sum(1 for check in self.checks if check["status"] == PASS)
        failed = sum(1 for check in self.checks if check["status"] == FAIL)
        warnings = sum(1 for check in self.checks if check["status"] == WARN)

        overall = FAIL if failed else PASS
        failing = [check["name"] for check in self.checks if check["status"] == FAIL]

        summary = (
            f"{passed} passed, {failed} failed, {warnings} warning(s)."
            + (f" Blocking: {', '.join(failing)}." if failing else "")
        )

        self.result = {
            "overall": overall,
            "checks": list(self.checks),
            "passed_count": passed,
            "failed_count": failed,
            "warning_count": warnings,
            "summary": summary,
        }
        return self.result
