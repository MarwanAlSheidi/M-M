"""Cost tracking, tied to correctness rather than to token counts alone.

Tokens spent is a billing number. Cost per *correct record* is the number that
decides whether a model is worth running, so every usage entry arrives with the
correctness outcomes for the record it paid for.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .utils import normalize_null


def _as_int(value: Any) -> int:
    if normalize_null(value) is None:
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


class CostTracker:
    """Accumulates token usage and joins it to per-record correctness."""

    def __init__(
        self,
        input_per_1m: float = 0.0,
        output_per_1m: float = 0.0,
        model: str = "unknown",
    ) -> None:
        self.input_per_1m = float(input_per_1m)
        self.output_per_1m = float(output_per_1m)
        self.model = model

        self.records: List[Dict[str, Any]] = []
        self.total_input_tokens = 0
        self.total_output_tokens = 0

        self.records_correct = 0
        self.records_raw_exact = 0
        self.records_critical_exact = 0
        self.fields_correct = 0
        self.fields_total = 0

    # ------------------------------------------------------------------

    @classmethod
    def from_config(cls, model_config: Dict[str, Any]) -> "CostTracker":
        pricing = (model_config or {}).get("pricing") or {}
        return cls(
            input_per_1m=pricing.get("input_per_1m", 0.0),
            output_per_1m=pricing.get("output_per_1m", 0.0),
            model=(model_config or {}).get("model", "unknown"),
        )

    # ------------------------------------------------------------------

    def add_usage(
        self,
        usage: Optional[Dict[str, Any]],
        product_id: Any,
        field_correct: Optional[Dict[str, bool]] = None,
        is_record_correct: bool = False,
        raw_exact_match: bool = False,
        is_critical_exact_match: bool = False,
    ) -> Dict[str, Any]:
        """Record one record's token spend alongside how well it scored."""
        usage = usage or {}
        field_correct = field_correct or {}

        input_tokens = _as_int(
            usage.get("prompt_tokens", usage.get("input_tokens", 0))
        )
        output_tokens = _as_int(
            usage.get("completion_tokens", usage.get("output_tokens", 0))
        )

        self.total_input_tokens += input_tokens
        self.total_output_tokens += output_tokens

        correct_fields = sum(1 for value in field_correct.values() if value)
        self.fields_correct += correct_fields
        self.fields_total += len(field_correct)

        self.records_correct += 1 if is_record_correct else 0
        self.records_raw_exact += 1 if raw_exact_match else 0
        self.records_critical_exact += 1 if is_critical_exact_match else 0

        entry = {
            "product_id": str(product_id),
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": self._price(input_tokens, output_tokens),
            "fields_correct": correct_fields,
            "fields_total": len(field_correct),
            "is_record_correct": bool(is_record_correct),
            "raw_exact_match": bool(raw_exact_match),
            "is_critical_exact_match": bool(is_critical_exact_match),
        }
        self.records.append(entry)
        return entry

    # ------------------------------------------------------------------

    def _price(self, input_tokens: int, output_tokens: int) -> float:
        cost = (
            input_tokens / 1_000_000.0 * self.input_per_1m
            + output_tokens / 1_000_000.0 * self.output_per_1m
        )
        return round(cost, 8)

    @property
    def total_cost_usd(self) -> float:
        return round(self._price(self.total_input_tokens, self.total_output_tokens), 8)

    @staticmethod
    def _ratio(numerator: float, denominator: float) -> float:
        return round(numerator / denominator, 8) if denominator else 0.0

    def summary(self) -> Dict[str, Any]:
        """Cost joined to correctness. Zero denominators return 0.0, not NaN."""
        total_records = len(self.records)
        total_cost = self.total_cost_usd

        return {
            "model": self.model,
            "pricing_input_per_1m": self.input_per_1m,
            "pricing_output_per_1m": self.output_per_1m,
            "records": total_records,
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "total_tokens": self.total_input_tokens + self.total_output_tokens,
            "total_cost_usd": total_cost,
            "cost_per_record_usd": self._ratio(total_cost, total_records),
            "records_correct": self.records_correct,
            "records_raw_exact_match": self.records_raw_exact,
            "records_critical_exact_match": self.records_critical_exact,
            "cost_per_correct_record_usd": self._ratio(total_cost, self.records_correct),
            "cost_per_critical_exact_record_usd": self._ratio(
                total_cost, self.records_critical_exact
            ),
            "fields_correct": self.fields_correct,
            "fields_total": self.fields_total,
            "cost_per_correct_field_usd": self._ratio(total_cost, self.fields_correct),
        }
