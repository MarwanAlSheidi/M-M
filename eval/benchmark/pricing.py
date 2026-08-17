"""Pricing lookup.

The one rule: an unknown price is ``None``, never zero and never estimated.
A missing price rendered as 0.00 in a comparison table reads as "free", which
is the most expensive kind of wrong a cost report can be.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import yaml

from .exceptions import ConfigError


@dataclass(frozen=True)
class PriceEntry:
    """Price for one provider/model pair, per 1M tokens."""

    provider: str
    model: str
    input_cost_per_1m: float
    output_cost_per_1m: float
    currency: str = "USD"
    verified_on: Optional[str] = None
    source: Optional[str] = None

    def cost_for(
        self,
        input_tokens: Optional[int],
        output_tokens: Optional[int],
    ) -> Optional[float]:
        """Cost in ``currency``, or None if token counts are unavailable.

        A provider that returns no usage means the cost is unknown. Treating
        missing tokens as zero would understate the spend of exactly the calls
        that failed or truncated.
        """
        if input_tokens is None and output_tokens is None:
            return None

        used_input = float(input_tokens or 0)
        used_output = float(output_tokens or 0)

        cost = (
            used_input / 1_000_000.0 * self.input_cost_per_1m
            + used_output / 1_000_000.0 * self.output_cost_per_1m
        )
        return round(cost, 10)


class PricingTable:
    """Provider/model to price. Absent entries resolve to ``None``."""

    def __init__(self, entries: List[PriceEntry], source_path: Optional[str] = None) -> None:
        self._entries: Dict[tuple, PriceEntry] = {
            (entry.provider, entry.model): entry for entry in entries
        }
        self.source_path = source_path

    # ------------------------------------------------------------------

    @classmethod
    def from_yaml(cls, path: str) -> "PricingTable":
        if not os.path.exists(path):
            raise ConfigError(f"Pricing config not found: {path}")

        try:
            with open(path, "r", encoding="utf-8") as handle:
                raw = yaml.safe_load(handle) or {}
        except yaml.YAMLError as exc:
            raise ConfigError(f"Malformed pricing YAML at {path}: {exc}") from exc

        if not isinstance(raw, dict):
            raise ConfigError("Pricing config must be a mapping")

        default_currency = raw.get("currency", "USD")
        rows = raw.get("pricing") or []
        if not isinstance(rows, list):
            raise ConfigError("Pricing 'pricing' must be a list")

        entries: List[PriceEntry] = []
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise ConfigError(f"Pricing entry {index} must be a mapping")

            missing = [
                key
                for key in ("provider", "model", "input_cost_per_1m", "output_cost_per_1m")
                if row.get(key) is None
            ]
            if missing:
                raise ConfigError(
                    f"Pricing entry {index} is missing: {', '.join(missing)}"
                )

            entries.append(
                PriceEntry(
                    provider=str(row["provider"]),
                    model=str(row["model"]),
                    input_cost_per_1m=float(row["input_cost_per_1m"]),
                    output_cost_per_1m=float(row["output_cost_per_1m"]),
                    currency=str(row.get("currency", default_currency)),
                    verified_on=row.get("verified_on"),
                    source=row.get("source"),
                )
            )

        return cls(entries, source_path=path)

    # ------------------------------------------------------------------

    def lookup(self, provider: str, model: Optional[str]) -> Optional[PriceEntry]:
        """Price for a provider/model pair, or None when not configured."""
        if not model:
            return None
        return self._entries.get((provider, model))

    def cost_for(
        self,
        provider: str,
        model: Optional[str],
        input_tokens: Optional[int],
        output_tokens: Optional[int],
    ) -> Optional[float]:
        """Cost for one call, or None when price or usage is unavailable."""
        entry = self.lookup(provider, model)
        if entry is None:
            return None
        return entry.cost_for(input_tokens, output_tokens)

    def currency_for(self, provider: str, model: Optional[str]) -> Optional[str]:
        entry = self.lookup(provider, model)
        return entry.currency if entry else None

    def describe(self, provider: str, model: Optional[str]) -> Dict[str, Any]:
        """Pricing provenance for the run metadata."""
        entry = self.lookup(provider, model)
        if entry is None:
            return {
                "priced": False,
                "reason": f"no pricing configured for {provider}/{model}",
                "input_cost_per_1m": None,
                "output_cost_per_1m": None,
                "currency": None,
            }
        return {
            "priced": True,
            "input_cost_per_1m": entry.input_cost_per_1m,
            "output_cost_per_1m": entry.output_cost_per_1m,
            "currency": entry.currency,
            "verified_on": entry.verified_on,
            "source": entry.source,
        }

    def keys(self) -> List[tuple]:
        return sorted(self._entries)
