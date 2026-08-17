"""Run auditing — the append-only record of what a run did.

Every integrity decision, prompt hash and per-record error lands here as a
JSONL event. The audit log is the thing you read six months later when two runs
disagree and both claim the same dataset version.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pandas as pd


def _json_default(value: Any) -> Any:
    """Make numpy/pandas scalars and NaN safe for json.dump.

    NaN is the important one: ``json.dumps`` emits bare ``NaN``, which is
    invalid JSON and fails to parse on read-back. It becomes ``None`` here.
    """
    if isinstance(value, float) and value != value:
        return None
    if value is pd.NA or value is pd.NaT:
        return None
    if hasattr(value, "item"):
        try:
            return value.item()
        except (ValueError, AttributeError):
            # Not a 0-d numpy scalar after all; fall through to the checks
            # below rather than guessing at a representation here.
            pass
    if isinstance(value, (set, frozenset)):
        return sorted(value)
    return str(value)


def sanitize_for_json(obj: Any) -> Any:
    """Recursively replace NaN/pd.NA with None so output is valid JSON."""
    if isinstance(obj, dict):
        return {key: sanitize_for_json(value) for key, value in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [sanitize_for_json(value) for value in obj]
    if isinstance(obj, float) and obj != obj:
        return None
    if obj is pd.NA or obj is pd.NaT:
        return None
    if hasattr(obj, "item") and not isinstance(obj, (str, bytes)):
        try:
            return obj.item()
        except (ValueError, AttributeError):
            return obj
    return obj


class Auditor:
    """Writes the run's audit trail into ``run_dir``."""

    def __init__(self, run_dir: str, redactor: Any = None) -> None:
        self.run_dir = run_dir
        os.makedirs(run_dir, exist_ok=True)
        self.events_path = os.path.join(run_dir, "audit_events.jsonl")
        # v2.0.5: `audit.jsonl` is the documented artefact name; the original
        # path is kept as the same file so existing readers do not break.
        self.audit_path = os.path.join(run_dir, "audit.jsonl")
        self.events: List[Dict[str, Any]] = []

        # Every write goes through here. A secret that reaches an audit file
        # has already leaked, so redaction belongs at the boundary rather than
        # at each call site that might forget.
        from .redaction import default_redactor

        self.redactor = redactor or default_redactor()

    # ------------------------------------------------------------------

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def log_event(self, kind: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Append one event to the trail and return it."""
        event = {
            "timestamp": self._now(),
            "kind": kind,
            "payload": self.redactor.redact(sanitize_for_json(payload or {})),
        }
        self.events.append(event)

        line = json.dumps(event, ensure_ascii=False, default=_json_default) + "\n"
        for path in (self.events_path, self.audit_path):
            with open(path, "a", encoding="utf-8") as handle:
                handle.write(line)

        return event

    def save_json(self, name: str, payload: Any) -> str:
        """Write a JSON artefact into the run directory."""
        path = os.path.join(self.run_dir, name)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(
                self.redactor.redact(sanitize_for_json(payload)),
                handle,
                indent=2,
                ensure_ascii=False,
                default=_json_default,
                allow_nan=False,
            )
        return path

    def save_jsonl(self, name: str, rows: List[Dict[str, Any]]) -> str:
        """Write a JSONL artefact, one sanitized object per line."""
        path = os.path.join(self.run_dir, name)
        with open(path, "w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(
                    json.dumps(
                        self.redactor.redact(sanitize_for_json(row)),
                        ensure_ascii=False,
                        default=_json_default,
                        allow_nan=False,
                    )
                    + "\n"
                )
        return path

    def path_for(self, name: str) -> str:
        return os.path.join(self.run_dir, name)
