"""Dataset manifest and split validation.

The evaluation dataset is immutable input. This module pins it — content
hashes plus a hash over the sorted product_id set — and refuses execution when
what is on disk stops matching what the manifest describes.

``product_id_hash`` deserves its own field: two files can differ in row order,
quoting or line endings (so their content hashes differ) while describing
exactly the same records. Comparing both tells you *which* kind of change
happened, which is the difference between "regenerated the CSV" and "changed
the evaluation set".

Splits are checked here too. Training or validation records leaking into
evaluation invalidates the measurement, and it is invisible in the numbers.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Iterable, List, Optional, Set

import pandas as pd

from .exceptions import ConfigError, IntegrityError
from .utils import compute_dict_hash, compute_file_hash

FIXTURE = "fixture"
PRODUCTION = "production"

SPLIT_TRAINING = "training"
SPLIT_VALIDATION = "validation"
SPLIT_EVALUATION = "evaluation"

_MAX_REPORTED_IDS = 20


def read_ids(path: str, column: str = "product_id") -> List[str]:
    """Read an id column as normalized strings.

    ``dtype=str`` with ``keep_default_na=False`` so an id of ``NA`` stays the
    string "NA" and a numeric id never becomes "1.0".
    """
    if not path or not os.path.exists(path):
        return []

    frame = pd.read_csv(path, dtype=str, keep_default_na=False)
    if column not in frame.columns:
        if frame.shape[1] == 1:
            values = frame.iloc[:, 0].tolist()
        else:
            raise ConfigError(f"{path} has no '{column}' column")
    else:
        values = frame[column].tolist()

    return [str(value).strip() for value in values]


def product_id_hash(ids: Iterable[str]) -> str:
    """Order-independent hash of a record-id set.

    Sorted and de-duplicated first, so it answers "are these the same records?"
    and not "is this the same file?".
    """
    unique = sorted({str(value).strip() for value in ids if str(value).strip()})
    return compute_dict_hash({"product_ids": unique})


def build_dataset_manifest(
    dataset_path: str,
    gold_path: str,
    taxonomy_path: str,
    synonyms_path: str,
    critical_fields_path: str,
    prompt_sha256: str,
    prompt_name: str,
    prompt_version: str,
    dataset_kind: str = FIXTURE,
    training_path: Optional[str] = None,
    validation_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Compute every hash the benchmark pins for one dataset."""
    if dataset_kind not in (FIXTURE, PRODUCTION):
        raise ConfigError(f"dataset_kind must be {FIXTURE!r} or {PRODUCTION!r}")

    dataset_ids = read_ids(dataset_path)

    return {
        "dataset_kind": dataset_kind,
        "dataset_path": os.path.relpath(dataset_path, os.path.dirname(os.path.dirname(os.path.abspath(dataset_path)))),
        "dataset_sha256": compute_file_hash(dataset_path),
        "gold_sha256": compute_file_hash(gold_path),
        "record_count": len(dataset_ids),
        "product_id_hash": product_id_hash(dataset_ids),
        "taxonomy_sha256": compute_file_hash(taxonomy_path),
        "synonyms_sha256": compute_file_hash(synonyms_path),
        "critical_fields_sha256": compute_file_hash(critical_fields_path),
        "prompt_sha256": prompt_sha256,
        "prompt_name": prompt_name,
        "prompt_version": prompt_version,
        "splits": {
            SPLIT_TRAINING: len(read_ids(training_path)) if training_path else 0,
            SPLIT_VALIDATION: len(read_ids(validation_path)) if validation_path else 0,
            SPLIT_EVALUATION: len(dataset_ids),
        },
    }


def verify_dataset_manifest(
    expected: Dict[str, Any],
    actual: Dict[str, Any],
) -> List[str]:
    """Return the list of drifted keys. Empty means the dataset is unchanged."""
    checked = (
        "dataset_sha256",
        "gold_sha256",
        "record_count",
        "product_id_hash",
        "taxonomy_sha256",
        "synonyms_sha256",
        "critical_fields_sha256",
        "prompt_sha256",
    )
    return [key for key in checked if expected.get(key) != actual.get(key)]


class SplitRegistry:
    """The three splits, and the guarantee that they stay disjoint."""

    def __init__(
        self,
        training: Optional[Iterable[str]] = None,
        validation: Optional[Iterable[str]] = None,
        evaluation: Optional[Iterable[str]] = None,
    ) -> None:
        self.training: Set[str] = self._clean(training)
        self.validation: Set[str] = self._clean(validation)
        self.evaluation: Set[str] = self._clean(evaluation)

    @staticmethod
    def _clean(values: Optional[Iterable[str]]) -> Set[str]:
        return {str(value).strip() for value in (values or []) if str(value).strip()}

    # ------------------------------------------------------------------

    @classmethod
    def from_paths(
        cls,
        training_path: Optional[str] = None,
        validation_path: Optional[str] = None,
        evaluation_path: Optional[str] = None,
    ) -> "SplitRegistry":
        return cls(
            training=read_ids(training_path) if training_path else [],
            validation=read_ids(validation_path) if validation_path else [],
            evaluation=read_ids(evaluation_path) if evaluation_path else [],
        )

    def overlaps(self) -> Dict[str, List[str]]:
        """Every forbidden intersection, named.

        Training∩validation is reported but is not itself fatal: tuning on the
        validation split is the point of having one. Only contamination *of
        evaluation* invalidates the measurement.
        """
        return {
            "training_evaluation": sorted(self.training & self.evaluation),
            "validation_evaluation": sorted(self.validation & self.evaluation),
            "training_validation": sorted(self.training & self.validation),
        }

    def fatal_overlaps(self) -> Dict[str, List[str]]:
        overlaps = self.overlaps()
        return {
            key: ids
            for key, ids in overlaps.items()
            if ids and key in ("training_evaluation", "validation_evaluation")
        }

    def assert_clean(self) -> None:
        """Raise IntegrityError if anything has leaked into evaluation."""
        fatal = self.fatal_overlaps()
        if fatal:
            details = "; ".join(
                f"{key}: {len(ids)} shared ({', '.join(ids[:_MAX_REPORTED_IDS])})"
                for key, ids in fatal.items()
            )
            raise IntegrityError(f"Split contamination — {details}")

    def summary(self) -> Dict[str, Any]:
        overlaps = self.overlaps()
        return {
            "counts": {
                SPLIT_TRAINING: len(self.training),
                SPLIT_VALIDATION: len(self.validation),
                SPLIT_EVALUATION: len(self.evaluation),
            },
            "overlaps": {key: len(ids) for key, ids in overlaps.items()},
            "clean": not self.fatal_overlaps(),
        }


def load_manifest(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:
        raise ConfigError(f"Malformed dataset manifest at {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError("Dataset manifest must be a JSON object")
    return data
