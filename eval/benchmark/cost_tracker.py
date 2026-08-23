"""Cost and operational tracking, tied to correctness rather than tokens alone.

Tokens spent is a billing number. Cost per *correct record* is the number that
decides whether a model is worth running, so every usage entry arrives with the
correctness outcomes for the record it paid for.

v2.0.5 adds per-call accounting on top, without changing the v2.0.4 surface:
:meth:`add_call` records what one provider call actually cost, how long it
took, how many attempts it needed and whether it succeeded. Two rules hold
throughout:

* An unknown price yields ``None``, never ``0.0``. A missing price rendered as
  free is the most expensive mistake a cost report can make.
* Token counts are never invented. A provider that returns no usage produces
  ``None`` tokens and therefore ``None`` cost.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .statistics import latency_summary, safe_ratio
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

        # v2.0.5 per-call accounting, keyed by product_id.
        self.calls: Dict[str, Dict[str, Any]] = {}
        self.currency: Optional[str] = None

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

    def add_call(
        self,
        product_id: Any,
        latency_ms: Optional[float] = None,
        cost: Optional[float] = None,
        currency: Optional[str] = None,
        input_tokens: Optional[int] = None,
        output_tokens: Optional[int] = None,
        attempt_count: int = 1,
        final_status: str = "success",
    ) -> Dict[str, Any]:
        """Record one provider call's operational facts.

        Called once per record by the v2.0.5 pipeline, before correctness is
        known. ``cost`` of ``None`` means the price or the token counts were
        unavailable and must stay unknown all the way to the report.
        """
        if currency and self.currency is None:
            self.currency = currency

        entry = {
            "product_id": str(product_id),
            "latency_ms": latency_ms,
            "cost": cost,
            "currency": currency,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": (
                None
                if input_tokens is None and output_tokens is None
                else int(input_tokens or 0) + int(output_tokens or 0)
            ),
            "attempt_count": int(attempt_count),
            "final_status": final_status,
            "retried": int(attempt_count) > 1,
        }
        self.calls[str(product_id)] = entry
        return entry

    # ------------------------------------------------------------------

    def operations_summary(self, exact_matches: int = 0, accuracy: Optional[float] = None) -> Dict[str, Any]:
        """Operational and price-table cost metrics for a v2.0.5 run.

        Failed calls are excluded from accuracy elsewhere, but they stay in
        these numbers: a model that times out is slow, not absent.
        """
        calls = list(self.calls.values())
        total_calls = len(calls)

        successes = sum(1 for call in calls if call["final_status"] == "success")
        failures = total_calls - successes
        retried = sum(1 for call in calls if call["retried"])

        costs = [call["cost"] for call in calls]
        priced = bool(costs) and all(cost is not None for cost in costs)
        total_cost = round(sum(cost or 0.0 for cost in costs), 10) if priced else None

        token_values = [call["total_tokens"] for call in calls]
        tokens_known = bool(token_values) and all(value is not None for value in token_values)

        summary: Dict[str, Any] = {
            "calls": total_calls,
            "successes": successes,
            "failures": failures,
            "retried_calls": retried,
            "success_rate": safe_ratio(successes, total_calls),
            "failure_rate": safe_ratio(failures, total_calls),
            "retry_rate": safe_ratio(retried, total_calls),
            "priced": priced,
            "currency": self.currency,
            "tokens_available": tokens_known,
            "total_tokens": (
                sum(value or 0 for value in token_values) if tokens_known else None
            ),
            "total_cost": total_cost,
        }
        summary.update(latency_summary([call["latency_ms"] for call in calls]))

        # Every cost-per-X is None when the run is unpriced, and 0.0 only when
        # the price is genuinely known to be zero.
        def per(denominator: float) -> Optional[float]:
            if total_cost is None:
                return None
            if not denominator:
                return None
            return round(total_cost / denominator, 10)

        summary["cost_per_record"] = per(total_calls)
        summary["cost_per_correct_record"] = per(self.records_correct)
        summary["cost_per_critical_correct_record"] = per(self.records_critical_exact)
        summary["cost_per_exact_match"] = per(exact_matches)

        # Cost to buy one percentage point of accuracy on this dataset. Only
        # meaningful alongside the accuracy it was computed from.
        if total_cost is None or not accuracy:
            summary["cost_per_1_percent_accuracy"] = None
        else:
            summary["cost_per_1_percent_accuracy"] = round(total_cost / (accuracy * 100.0), 10)
        summary["accuracy_used_for_cost"] = accuracy

        return summary

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
