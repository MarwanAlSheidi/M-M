"""Shared primitives: null handling, hashing, and status printing.

Null handling lives here and only here. Pandas gives us at least four ways to
say "no value" (``None``, ``float('nan')``, ``pd.NA``, ``pd.NaT``) and CSV
round-trips add three more (``""``, ``"nan"``, ``"null"``). Every one of them
must collapse to a single ``None`` before any comparison happens, or a gold
value of ``NaN`` and a prediction of ``None`` will score as a mismatch.
"""

from __future__ import annotations

import hashlib
import json
import os
from typing import Any, Dict, Optional

import pandas as pd

# String spellings of "no value" that survive a CSV round-trip.
_NULL_STRINGS = frozenset({"", "nan", "none", "null", "<na>", "nat"})

_STATUS_ICONS = {
    "PASS": "✅",
    "FAIL": "❌",
    "WARN": "⚠️",
    "INFO": "ℹ️",
}


def is_empty_value(value: Any) -> bool:
    """Return True if ``value`` means "no value" in any of its spellings.

    Containers are never empty-valued: an empty list is a type error at the
    call sites that use this, not a null, and must stay distinguishable.
    """
    if value is None:
        return True

    if isinstance(value, (list, tuple, set, dict)):
        return False

    # pd.isna raises on some inputs and returns an array for others; both mean
    # "not a scalar null".
    try:
        result = pd.isna(value)
        if isinstance(result, bool) and result:
            return True
    except (TypeError, ValueError):
        pass

    if isinstance(value, str):
        return value.strip().lower() in _NULL_STRINGS

    return False


def normalize_null(value: Any) -> Optional[Any]:
    """Collapse every spelling of null to ``None``; pass anything else through.

    Non-null values are returned unchanged — no stripping, no casing. Those are
    canonicalization concerns and belong to the Canonicalizer.
    """
    if is_empty_value(value):
        return None
    return value


def safe_str(value: Any) -> str:
    """Stringify for display or search without ever producing ``"nan"``/``"None"``."""
    if is_empty_value(value):
        return ""
    return str(value)


def compute_file_hash(path: str) -> str:
    """SHA256 of a file's bytes, streamed so large CSVs do not load into RAM."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"Cannot hash missing file: {path}")

    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(8192), b""):
            digest.update(chunk)
    return digest.hexdigest()


def compute_dict_hash(obj: Any) -> str:
    """SHA256 of a deterministic JSON serialization.

    ``sort_keys`` plus the compact separators mean the hash depends on the
    object's content and nothing else — not on key insertion order, not on
    whitespace, not on the Python version's dict ordering.
    """
    encoded = json.dumps(
        obj,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def print_check_status(gate: Any) -> None:
    """Print an integrity-gate result as a readable report.

    Accepts either the dict returned by ``IntegrityGate.run()`` or the gate
    object itself, so callers can hand over whichever they are holding.
    """
    result: Dict[str, Any]
    if isinstance(gate, dict):
        result = gate
    elif hasattr(gate, "result") and isinstance(getattr(gate, "result"), dict):
        result = getattr(gate, "result")
    elif hasattr(gate, "run"):
        result = gate.run()
    else:
        raise TypeError(f"Cannot read integrity result from {type(gate)!r}")

    print("=" * 70)
    print("INTEGRITY GATE")
    print("=" * 70)

    for check in result.get("checks", []):
        icon = _STATUS_ICONS.get(check.get("status", ""), "•")
        print(f"{icon} [{check.get('status'):<4}] {check.get('name')}: {check.get('message')}")

        for line in check.get("details", []) or []:
            print(f"        {line}")

    print("-" * 70)
    print(
        f"passed={result.get('passed_count', 0)} "
        f"failed={result.get('failed_count', 0)} "
        f"warnings={result.get('warning_count', 0)}"
    )
    print(f"OVERALL: {result.get('overall')}")
    print("=" * 70)
