"""Orchestrates: inputs -> (ML anomaly check | ML fill, guarded) -> engine -> thresholds -> narrative."""
from __future__ import annotations
from decimal import Decimal

from fastapi import HTTPException

from costing.engine import InfeasibleTarget, compute_landed, solve_max_purchase_price_per_input_unit
from costing.fx import FxResolver
from costing.money import Money
from costing.units import convert_mass
from ml.integrate import apply_ml_predictions

from ..i18n import narrative
from ..repos import market_repo, product_repo, stats_repo
from ..schemas import (CostLineOut, GuardOut, MLInputOut, MoneyOut, QuoteResponse,
                       QuoteVsForecastOut, SHAPFeature)
from .forecast import champion_forecast
from .inputs import build_inputs
from .pricing_mode import PricingMode


def _money(m: Money) -> MoneyOut:
    return MoneyOut(amount_minor=m.amount_minor, amount_major=str(m.major), currency=m.currency)


def _line(l) -> CostLineOut:
    return CostLineOut(type=l.type, amount_minor=l.amount.amount_minor, amount_major=str(l.amount.major),
                       currency=l.amount.currency, source=l.source, note=l.note)


def _rate(session, frm: str, to: str, as_of) -> Decimal | None:
    if frm == to:
        return Decimal("1")
    market = {}
    for c in (frm, to):
        r = market_repo.latest_fx_rate(session, c, "USD", as_of)
        if r is not None:
            market[f"{c}/USD"] = r
    try:
        return FxResolver(market).rate(frm, to)
    except ValueError:
        return None


def build_quote(session, tenant: dict, req, mode: PricingMode) -> QuoteResponse:
    tid = tenant["tenant_id"]
    inp = build_inputs(session, tid, req)
    product = product_repo.get_product(session, tid, req.product_sku)

    ml_log: list[MLInputOut] = []
    shap_top5: list[SHAPFeature] = []
    quote_vs_forecast = None
    ml_skipped_reason = None

    if mode in (PricingMode.ML_FILLS_PRICE, PricingMode.QUOTE_GIVEN_ANOMALY_CHECK):
        fc, skip = champion_forecast(session, tid, product, req.deal_date, req.currency)
        if skip:
            if mode is PricingMode.ML_FILLS_PRICE:
                raise HTTPException(422, f"ML requested but unavailable: {skip}")
            ml_skipped_reason = skip
        else:
            shap_top5 = fc.shap_top5
            p10, p50, p90 = fc.p10, fc.p50, fc.p90
            target_ccy, target_unit = fc.target_currency, fc.target_unit

            if mode is PricingMode.QUOTE_GIVEN_ANOMALY_CHECK:
                # ML never overrides a supplier quote; it only flags anomalies.
                q_native = req.purchase_unit_price_major
                rate = _rate(session, req.currency, target_ccy, req.deal_date)
                if rate is None:
                    ml_skipped_reason = f"no fx path {req.currency}->{target_ccy}"
                else:
                    # price per base_unit -> price per target_unit
                    q_cmp = q_native * rate
                    if req.base_unit != target_unit:
                        q_cmp = q_cmp / convert_mass(Decimal("1"), req.base_unit, target_unit)
                    dev = (q_cmp - p50) / p50 if p50 else Decimal("0")
                    inside = p10 <= q_cmp <= p90
                    quote_vs_forecast = QuoteVsForecastOut(
                        quote_price=str(q_native), forecast_p50=str(p50),
                        pct_deviation=str(dev.quantize(Decimal("0.0001"))), within_p10_p90=inside,
                        flag="ok" if inside else "outside_range",
                        compare_currency=target_ccy, compare_unit=target_unit)
            else:
                bounds = stats_repo.get_bounds(session, tid, product.market_key)
                if bounds is None:
                    raise HTTPException(422, "ML fill requires historical bounds (market_price_stats)")
                if target_ccy != req.currency or target_unit != req.base_unit:
                    raise HTTPException(422, "ML fill needs request currency/unit to match the model target")
                inp, applied = apply_ml_predictions(inp, predicted_purchase_major=p50, purchase_bounds=bounds)
                for a in applied:
                    ml_log.append(MLInputOut(field=a.field, predicted_value=str(a.value), guard=GuardOut(
                        accepted=a.guard.accepted, reason=a.guard.reason, final_value=str(a.guard.final_value))))

    result = compute_landed(inp)

    buy_below = None
    if req.market_sell_per_sellable_major:
        try:
            buy_below = solve_max_purchase_price_per_input_unit(
                base_inputs=inp,
                market_sell_per_sellable_unit=Money.from_major(req.market_sell_per_sellable_major, inp.base_currency),
                target_margin=Decimal(req.target_margin))
        except InfeasibleTarget:
            buy_below = None

    return QuoteResponse(
        lines=[_line(l) for l in result.lines],
        landed_cost=_money(result.landed_cost),
        sellable_qty=str(result.sellable_qty),
        landed_cost_per_sellable_unit=_money(result.landed_cost_per_sellable_unit),
        break_even_per_sellable_unit=_money(result.break_even_per_sellable_unit),
        sell_above_threshold=_money(result.sell_above_threshold),
        buy_below_threshold=_money(buy_below) if buy_below is not None else None,
        ml_inputs=ml_log, ml_fields=sorted(result.ml_fields), shap_top5=shap_top5,
        quote_vs_forecast=quote_vs_forecast, ml_skipped_reason=ml_skipped_reason,
        explanation=narrative(result, ml_log, shap_top5, req.locale), locale=req.locale,
    )
