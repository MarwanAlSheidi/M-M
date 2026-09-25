from __future__ import annotations

from costing.money import Money

_POS = {
    "en": {"attractive": "inside the envelope", "too_high": "above the ceiling",
           "too_low": "below the floor (covers cost, misses the minimum margin)",
           "not_viable": "below unit cost"},
    "ar": {"attractive": "داخل النطاق", "too_high": "أعلى من السقف",
           "too_low": "أقل من الحد الأدنى (يغطي التكلفة ولا يحقق الهامش الأدنى)",
           "not_viable": "أقل من تكلفة الوحدة"},
}


def _m(minor: int, ccy: str) -> str:
    return f"{Money(int(minor), ccy).major} {ccy}"


def narrative(env: dict, locale: str) -> str:
    """Stub narrative. LLM explanation (Claude API) is later scope."""
    ar = locale == "ar"
    c, u = env["currency"], env["unit"]
    if ar:
        s = (f"التكلفة لكل {u}: {_m(env['unit_cost_minor'], c)}. الحد الأدنى {_m(env['floor_minor'], c)}، "
             f"المستهدف {_m(env['target_minor'], c)}، السقف {_m(env['ceiling_minor'], c)}.")
    else:
        s = (f"Unit cost per {u}: {_m(env['unit_cost_minor'], c)}. Floor {_m(env['floor_minor'], c)}, "
             f"target {_m(env['target_minor'], c)}, ceiling {_m(env['ceiling_minor'], c)}.")
    mk = env.get("market")
    if mk:
        pos = _POS["ar" if ar else "en"][mk["position"]]
        ref = _m(mk["market_reference_minor"], c)
        s += f" سعر السوق {ref} {pos}." if ar else f" Market {ref} is {pos}."
    else:
        s += " لا توجد أسعار سوق حديثة." if ar else " No fresh market prices."
    return s
