"""Leakage detection — layer 2, running per record during execution.

Layer 1 is the IntegrityGate, which compares whole ID sets before the run
starts. This layer re-checks every record as it is classified, because a
dataset can be swapped, filtered or regenerated between the gate and the loop,
and a benchmark that only checks once measures the file it *used to* have.

Both layers raise :class:`LeakageError`. Neither warns and continues.
"""

from __future__ import annotations

import hashlib
import os
from typing import Any, Dict, Iterable, List, Optional, Set

import pandas as pd

from .exceptions import LeakageError
from .utils import safe_str


def normalize_id(value: Any) -> str:
    """Canonical product-id form: string, stripped. Used on every side."""
    return safe_str(value).strip()


def load_training_ids(path: str, id_column: str = "product_id") -> Set[str]:
    """Read training IDs from CSV. A missing file yields an empty set."""
    if not path or not os.path.exists(path):
        return set()

    frame = pd.read_csv(path, dtype=str, keep_default_na=False)
    if id_column not in frame.columns:
        # Single-column files without a header row are common for ID lists.
        if frame.shape[1] == 1:
            values = frame.iloc[:, 0].tolist()
        else:
            return set()
    else:
        values = frame[id_column].tolist()

    return {normalize_id(value) for value in values if normalize_id(value)}


class LeakageDetector:
    """Holds the training set and refuses any evaluation record inside it."""

    def __init__(
        self,
        training_ids: Optional[Iterable[str]] = None,
        training_texts: Optional[Iterable[str]] = None,
    ) -> None:
        self.training_ids: Set[str] = {
            normalize_id(value) for value in (training_ids or []) if normalize_id(value)
        }
        # Exact-text hashes catch the same record re-published under a new ID.
        self.training_text_hashes: Set[str] = {
            self._hash_text(text) for text in (training_texts or []) if safe_str(text).strip()
        }
        self.violations: List[Dict[str, str]] = []

    # ------------------------------------------------------------------

    @classmethod
    def from_csv(
        cls,
        path: str,
        id_column: str = "product_id",
        text_columns: Optional[List[str]] = None,
    ) -> "LeakageDetector":
        if not path or not os.path.exists(path):
            return cls()

        frame = pd.read_csv(path, dtype=str, keep_default_na=False)
        ids = load_training_ids(path, id_column)

        texts: List[str] = []
        for column in text_columns or []:
            if column in frame.columns:
                texts.extend(frame[column].tolist())

        return cls(training_ids=ids, training_texts=texts)

    @staticmethod
    def _hash_text(text: Any) -> str:
        normalized = " ".join(safe_str(text).lower().split())
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    # ------------------------------------------------------------------

    def overlap_with(self, ids: Iterable[Any]) -> Set[str]:
        """IDs present in both the training set and ``ids``."""
        candidate = {normalize_id(value) for value in ids if normalize_id(value)}
        return self.training_ids & candidate

    def check_ids(self, ids: Iterable[Any], label: str = "evaluation") -> None:
        """Raise if any of ``ids`` is a training ID."""
        overlap = self.overlap_with(ids)
        if overlap:
            sample = ", ".join(sorted(overlap)[:20])
            raise LeakageError(
                f"Training data overlaps {label}: {len(overlap)} shared product_id(s). "
                f"First offenders: {sample}"
            )

    def check_record(self, product_id: Any, source_text: Any = "") -> None:
        """Raise if this single record came from the training set."""
        normalized = normalize_id(product_id)

        if normalized and normalized in self.training_ids:
            self.violations.append({"product_id": normalized, "kind": "id_overlap"})
            raise LeakageError(
                f"Leakage: product_id '{normalized}' is present in the training set."
            )

        text = safe_str(source_text).strip()
        if text and self._hash_text(text) in self.training_text_hashes:
            self.violations.append({"product_id": normalized, "kind": "text_overlap"})
            raise LeakageError(
                f"Leakage: source text for product_id '{normalized}' is byte-identical "
                "to a training record (re-published under a different id)."
            )

    @property
    def is_active(self) -> bool:
        """True when there is anything to check against."""
        return bool(self.training_ids or self.training_text_hashes)

    def summary(self) -> Dict[str, Any]:
        return {
            "training_id_count": len(self.training_ids),
            "training_text_hash_count": len(self.training_text_hashes),
            "violations": list(self.violations),
            "active": self.is_active,
        }
