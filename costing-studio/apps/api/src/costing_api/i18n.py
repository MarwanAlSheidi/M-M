from __future__ import annotations


def narrative(result, ml_log, shap_top5, locale: str) -> str:
    """Stub narrative. LLM explanation (Claude API) is later scope."""
    if locale == "ar":
        base = (f"التكلفة الإجمالية للوصول: {result.landed_cost.major} {result.landed_cost.currency}. "
                f"التكلفة لكل كيلوغرام قابل للبيع: {result.landed_cost_per_sellable_unit.major}.")
        return base + (" تم استخدام قيم تنبؤية." if ml_log else "")
    base = (f"Landed cost: {result.landed_cost.major} {result.landed_cost.currency}. "
            f"Per sellable kg: {result.landed_cost_per_sellable_unit.major}.")
    return base + (" ML-predicted inputs were applied (see provenance)." if ml_log else "")
