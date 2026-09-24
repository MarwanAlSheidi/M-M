"""Lossless JSON round-trip for DealInputs (stored as deals.inputs_snapshot)."""
from __future__ import annotations
from dataclasses import fields
from datetime import date
from decimal import Decimal
from typing import Any

from .models import DealInputs
from .money import Money


def _enc(v: Any) -> Any:
    if isinstance(v, Decimal):
        return {"__dec__": str(v)}
    if isinstance(v, date):
        return {"__date__": v.isoformat()}
    if isinstance(v, (set, frozenset)):
        return {"__set__": sorted(v)}
    if isinstance(v, Money):
        return {"__money__": [v.amount_minor, v.currency]}
    if isinstance(v, dict):
        return {str(k): _enc(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_enc(x) for x in v]
    return v


def _dec(v: Any) -> Any:
    if isinstance(v, dict):
        if "__dec__" in v:
            return Decimal(v["__dec__"])
        if "__date__" in v:
            return date.fromisoformat(v["__date__"])
        if "__set__" in v:
            return set(v["__set__"])
        if "__money__" in v:
            minor, ccy = v["__money__"]
            return Money(int(minor), ccy)
        return {k: _dec(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_dec(x) for x in v]
    return v


def to_json(inp: DealInputs) -> dict:
    # Iterate fields explicitly: dataclasses.asdict would flatten Money.
    return {f.name: _enc(getattr(inp, f.name)) for f in fields(inp)}


def from_json(data: dict) -> DealInputs:
    kw = {k: _dec(v) for k, v in data.items()}
    kw["locked_rates"] = {k: Decimal(str(v)) for k, v in (kw.get("locked_rates") or {}).items()}
    kw["ml_fields"] = set(kw.get("ml_fields") or [])
    return DealInputs(**kw)
