from __future__ import annotations
import dataclasses
from decimal import Decimal, ROUND_HALF_UP
from typing import List
from .currencies import exponent_of
from .money import Money
from .models import CostLine, CostingResult, DealInputs
TEN_PCT = Decimal("1.10")
_DIRECT_ML_LINES = {
    "purchase": {"purchase_unit_price_major"}, "origin": {"origin_charges"},
    "freight": {"freight_total"}, "processing": {"processing_rate_per_unit"},
    "storage": {"storage_rate_per_unit_day"}, "clearing": {"clearing_fixed"},
}
_DERIVED_ML_LINES = {
    "insurance": {"insurance_rate", "purchase_unit_price_major", "freight_total", "origin_charges"},
    "duty": {"purchase_unit_price_major", "freight_total", "insurance_rate", "origin_charges"},
    "vat": {"purchase_unit_price_major", "freight_total", "insurance_rate", "origin_charges"},
}
def _source_for(t, mlf):
    if t in _DIRECT_ML_LINES and (_DIRECT_ML_LINES[t] & mlf): return "ml"
    if t in _DERIVED_ML_LINES and (_DERIVED_ML_LINES[t] & mlf): return "ml_derived"
    return "formula"
def _to_base(m, rates, base):
    if m.currency == base: return m
    if m.currency not in rates: raise ValueError(f"No locked rate for {m.currency}")
    scale = Decimal(10) ** (exponent_of(base) - exponent_of(m.currency))
    converted = Decimal(m.amount_minor) * rates[m.currency] * scale
    return Money(int(converted.quantize(Decimal("1"), ROUND_HALF_UP)), base)
def _incoterm_flags(incoterm):
    return {
        "EXW": {"origin": True, "freight": True, "insurance": True, "duty": True},
        "FOB": {"origin": False, "freight": True, "insurance": True, "duty": True},
        "CFR": {"origin": False, "freight": False, "insurance": True, "duty": True},
        "CIF": {"origin": False, "freight": False, "insurance": False, "duty": True},
        "DAP": {"origin": False, "freight": False, "insurance": False, "duty": True},
        "DDP": {"origin": False, "freight": False, "insurance": False, "duty": False, "vat": False},
    }[incoterm]
def _purchase_amount(inp):
    return Money.from_major(inp.purchase_unit_price_major * inp.quantity, inp.currency)
def compute_costs(inp):
    base, rates, flags, mlf = inp.base_currency, inp.locked_rates, _incoterm_flags(inp.incoterm), inp.ml_fields
    lines: List[CostLine] = []
    def _acc(prior, own):
        return bool(own & mlf) or any(l.source in ("ml", "ml_derived") for l in prior)
    purchase_base = _to_base(_purchase_amount(inp), rates, base)
    lines.append(CostLine("purchase", purchase_base, source=_source_for("purchase", mlf)))
    if flags["origin"]:
        lines.append(CostLine("origin", _to_base(inp.origin_charges, rates, base), source=_source_for("origin", mlf)))
    else: lines.append(CostLine("origin", Money(0, base)))
    if flags["freight"]:
        lines.append(CostLine("freight", _to_base(inp.freight_total, rates, base), source=_source_for("freight", mlf)))
    else: lines.append(CostLine("freight", Money(0, base)))
    if flags["insurance"]:
        ins = (purchase_base + lines[2].amount) * (TEN_PCT * inp.insurance_rate)
        lines.append(CostLine("insurance", ins, source=_source_for("insurance", mlf)))
    else: lines.append(CostLine("insurance", Money(0, base)))
    cif = lines[0].amount + lines[1].amount + lines[2].amount + lines[3].amount
    if flags["duty"]:
        lines.append(CostLine("duty", cif * inp.duty_rate, source=_source_for("duty", mlf)))
    else: lines.append(CostLine("duty", Money(0, base)))
    vat_amount = (cif + lines[4].amount) * inp.vat_rate
    if flags.get("vat", True) is False: lines.append(CostLine("vat", Money(0, base)))
    elif inp.vat_recoverable: lines.append(CostLine("vat", Money(0, base)))
    else: lines.append(CostLine("vat", vat_amount, source=_source_for("vat", mlf)))
    lines.append(CostLine("clearing", _to_base(inp.clearing_fixed, rates, base), source=_source_for("clearing", mlf)))
    lines.append(CostLine("processing", inp.processing_rate_per_unit * inp.quantity, source=_source_for("processing", mlf)))
    lines.append(CostLine("storage", inp.storage_rate_per_unit_day * (inp.quantity * inp.storage_days), source=_source_for("storage", mlf)))
    cc = max(0, inp.days_to_customer_payment - inp.supplier_terms_days)
    pre = _sum(lines)
    cap = pre * (Decimal(cc) / Decimal(365) * inp.wacc)
    lines.append(CostLine("capital", cap, source="ml_derived" if _acc(lines, {"days_to_customer_payment", "supplier_terms_days", "wacc"}) else "formula"))
    pre_oh = _sum(lines)
    lines.append(CostLine("overhead", pre_oh * inp.overhead_pct, source="ml_derived" if _acc(lines, {"overhead_pct"}) else "formula"))
    return lines
def _sum(lines):
    total = lines[0].amount
    for ln in lines[1:]: total = total + ln.amount
    return total
def compute_landed(inp):
    if not (Decimal("0") < inp.yield_pct <= Decimal("1")): raise ValueError("yield")
    lines = compute_costs(inp)
    landed = _sum(lines)
    sellable = inp.quantity * inp.yield_pct
    pu = Money(int((Decimal(landed.amount_minor) / sellable).quantize(Decimal("1"), ROUND_HALF_UP)), landed.currency)
    return CostingResult(inputs=inp, lines=lines, landed_cost=landed, sellable_qty=sellable,
        landed_cost_per_sellable_unit=pu, break_even_per_sellable_unit=pu,
        sell_above_threshold=pu * (Decimal("1") + inp.min_margin), ml_fields=set(inp.ml_fields))
def sell_price_for_margin(lpu, m):
    if not (Decimal("0") <= m < Decimal("1")): raise ValueError("margin")
    return lpu * (Decimal("1") / (Decimal("1") - m))
def non_purchase_cost_per_input_unit(inp):
    np_ = [l for l in compute_costs(inp) if l.type != "purchase"]
    total = _sum(np_)
    return Money(int((Decimal(total.amount_minor) / inp.quantity).quantize(Decimal("1"), ROUND_HALF_UP)), total.currency)
def max_purchase_price_per_input_unit(market_sell_per_sellable_unit, target_margin, yield_pct, non_purchase_costs_per_input_unit):
    v = market_sell_per_sellable_unit * (Decimal("1") - target_margin) * yield_pct - non_purchase_costs_per_input_unit
    return Money(0, v.currency) if v.amount_minor < 0 else v
class InfeasibleTarget(ValueError): pass
def solve_max_purchase_price_per_input_unit(base_inputs, market_sell_per_sellable_unit, target_margin, max_iter=60):
    target_minor = (market_sell_per_sellable_unit * (Decimal("1") - target_margin)).amount_minor
    cc = base_inputs.currency; exp_cc = exponent_of(cc); fx = base_inputs.locked_rates[cc]
    def landed_at(m):
        p = Decimal(m) / (Decimal(10) ** exp_cc)
        return compute_landed(dataclasses.replace(base_inputs, purchase_unit_price_major=p)).landed_cost_per_sellable_unit.amount_minor
    if landed_at(0) > target_minor: raise InfeasibleTarget("infeasible")
    seed = max_purchase_price_per_input_unit(market_sell_per_sellable_unit, target_margin, base_inputs.yield_pct, non_purchase_cost_per_input_unit(base_inputs))
    seed_m = max(int((seed.major / fx * (Decimal(10) ** exp_cc)).quantize(Decimal("1"), ROUND_HALF_UP)), 1)
    lo, hi = 0, seed_m * 3
    for _ in range(30):
        if landed_at(hi) > target_minor: break
        hi *= 2
    it = 0
    while hi - lo > 1 and it < max_iter:
        mid = (lo + hi) // 2
        if landed_at(mid) <= target_minor: lo = mid
        else: hi = mid
        it += 1
    return Money(lo, cc)
