"""Run identity, fingerprinting and resumability.

A run's *fingerprint* is the set of hashes that must not change for two batches
of records to belong to the same experiment: dataset, gold, prompt, taxonomy,
synonyms, field policy, model config, pricing, code. The run id embeds a short
form of it, and resume refuses to continue when any of it has moved.

This is the difference between a resumed run and a corrupted one. Appending
records classified under a new prompt to records classified under the old one
produces a result file that no single configuration ever generated.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from .exceptions import IntegrityError
from .utils import compute_dict_hash

CHECKPOINT_FILE = "checkpoint.json"
METADATA_FILE = "metadata.json"

# Hashes that must match for a resume to be legitimate.
FINGERPRINT_KEYS = (
    "dataset_sha256",
    "gold_sha256",
    "prompt_sha256",
    "taxonomy_sha256",
    "synonyms_sha256",
    "critical_fields_sha256",
    "model_config_sha256",
    "pricing_sha256",
    "code_sha256",
)


def utc_stamp(moment: Optional[datetime] = None) -> str:
    return (moment or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")


@dataclass
class RunFingerprint:
    """Everything that must hold constant across a resumed run."""

    values: Dict[str, Optional[str]] = field(default_factory=dict)

    @property
    def digest(self) -> str:
        return compute_dict_hash({key: self.values.get(key) for key in FINGERPRINT_KEYS})

    @property
    def short(self) -> str:
        return self.digest[:8]

    def as_dict(self) -> Dict[str, Any]:
        payload = {key: self.values.get(key) for key in FINGERPRINT_KEYS}
        payload["fingerprint_sha256"] = self.digest
        return payload

    def drift_against(self, other: Dict[str, Any]) -> List[str]:
        """Keys whose value differs from a previously stored fingerprint."""
        return [key for key in FINGERPRINT_KEYS if self.values.get(key) != other.get(key)]


def build_run_id(model_key: str, fingerprint: RunFingerprint, moment: Optional[datetime] = None) -> str:
    """``<utc>_<model>_<short-fingerprint>``.

    Sortable by time, greppable by model, and distinguishable when the same
    model is run twice against different configuration.
    """
    safe_model = "".join(ch if (ch.isalnum() or ch in "-_") else "_" for ch in str(model_key))
    return f"{utc_stamp(moment)}_{safe_model}_{fingerprint.short}"


@dataclass
class Checkpoint:
    """Which records a run has already completed, and under what fingerprint."""

    run_id: str
    model_key: str
    fingerprint: Dict[str, Any]
    completed_ids: List[str] = field(default_factory=list)
    dataset_kind: str = "fixture"

    # ------------------------------------------------------------------

    @classmethod
    def load(cls, run_dir: str) -> Optional["Checkpoint"]:
        path = os.path.join(run_dir, CHECKPOINT_FILE)
        if not os.path.exists(path):
            return None

        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)

        return cls(
            run_id=data.get("run_id", ""),
            model_key=data.get("model_key", ""),
            fingerprint=data.get("fingerprint") or {},
            completed_ids=list(data.get("completed_ids") or []),
            dataset_kind=data.get("dataset_kind", "fixture"),
        )

    def save(self, run_dir: str) -> str:
        os.makedirs(run_dir, exist_ok=True)
        path = os.path.join(run_dir, CHECKPOINT_FILE)

        with open(path, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "run_id": self.run_id,
                    "model_key": self.model_key,
                    "dataset_kind": self.dataset_kind,
                    "fingerprint": self.fingerprint,
                    "completed_ids": self.completed_ids,
                    "completed_count": len(self.completed_ids),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                handle,
                indent=2,
            )
        return path

    @property
    def completed(self) -> Set[str]:
        return set(self.completed_ids)

    def mark(self, product_id: str) -> None:
        if product_id not in self.completed:
            self.completed_ids.append(product_id)


def assert_resumable(
    checkpoint: Checkpoint,
    fingerprint: RunFingerprint,
    model_key: str,
) -> None:
    """Refuse to resume a run whose inputs have changed.

    Every listed hash is compared. A resumed run that mixes two prompts is not
    a partially complete run — it is a result nobody can reproduce.
    """
    if checkpoint.model_key and checkpoint.model_key != model_key:
        raise IntegrityError(
            f"Cannot resume: checkpoint belongs to model {checkpoint.model_key!r}, "
            f"not {model_key!r}"
        )

    drift = fingerprint.drift_against(checkpoint.fingerprint or {})
    if drift:
        details = ", ".join(
            f"{key} (was {str(checkpoint.fingerprint.get(key))[:12]}…, "
            f"now {str(fingerprint.values.get(key))[:12]}…)"
            for key in drift
        )
        raise IntegrityError(
            "Cannot resume: the run configuration changed since the checkpoint. "
            f"Drifted: {details}"
        )


def find_latest_run(runs_root: str, model_key: str) -> Optional[str]:
    """Most recent run directory for ``model_key``, by sortable run id."""
    if not os.path.isdir(runs_root):
        return None

    candidates = [
        name
        for name in os.listdir(runs_root)
        if os.path.isdir(os.path.join(runs_root, name)) and f"_{model_key}_" in name
    ]
    if not candidates:
        return None

    return os.path.join(runs_root, sorted(candidates)[-1])
