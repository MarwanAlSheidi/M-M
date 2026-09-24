import dataclasses
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from costing.engine import InfeasibleTarget, compute_landed, solve_max_purchase_price_per_input_unit
from costing.money import Money
from costing.serialize import from_json

from ..deps import get_session, get_tenant
from ..schemas import DealThresholdsOut, MoneyOut, ThresholdPoint

router = APIRouter(prefix="/api/v1/deals", tags=["deals"])

CURVE_POINTS = 21          # purchase price from -30% to +30% of the deal price
CURVE_SPAN = Decimal("0.30")


def _money(m: Money) -> MoneyOut:
    return MoneyOut(amount_minor=m.amount_minor, amount_major=str(m.major), currency=m.currency)


@router.get("")
def list_deals(limit: int = Query(100, ge=1, le=500), golden: Optional[bool] = None, q: Optional[str] = None,
               tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    rows = session.execute(text("""
      SELECT d.id, d.deal_ref, d.deal_date, d.quantity, d.base_unit, d.incoterm, d.currency,
             d.origin_country, d.dest_country, d.actual_landed_cost_minor, d.actual_sell_price_minor,
             d.base_currency, d.is_golden, d.status, p.sku, p.name_en, p.name_ar
        FROM deals d JOIN products p ON p.id = d.product_id
       WHERE (CAST(:g AS boolean) IS NULL OR d.is_golden = :g2)
         AND (CAST(:q AS text) IS NULL OR d.deal_ref ILIKE :ql OR p.sku ILIKE :ql)
       ORDER BY d.deal_date DESC, d.deal_ref LIMIT :l
    """), {"g": golden, "g2": golden, "q": q, "ql": f"%{q}%", "l": limit}).mappings().all()
    return {"items": [dict(r) for r in rows]}


def _load_deal(session, deal_id: UUID):
    deal = session.execute(text("""
      SELECT d.id, d.deal_ref, d.deal_date, d.quantity, d.base_unit, d.incoterm, d.currency,
             d.origin_country, d.dest_country, d.base_currency, d.locked_rates, d.inputs_snapshot,
             d.actual_landed_cost_minor, d.actual_sell_price_minor, d.is_golden, d.status, d.created_at,
             p.sku, p.name_en, p.name_ar, p.hs_code
        FROM deals d JOIN products p ON p.id = d.product_id WHERE d.id = :id
    """), {"id": str(deal_id)}).mappings().first()
    if deal is None:   # RLS makes another tenant's deal look missing too
        raise HTTPException(404, "deal not found")
    return deal


@router.get("/{deal_id}")
def get_deal(deal_id: UUID, tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    deal = dict(_load_deal(session, deal_id))
    deal.pop("inputs_snapshot")
    lines = session.execute(text("""
      SELECT cost_type AS type, amount_minor, currency, source, note
        FROM deal_cost_lines WHERE deal_id = :id ORDER BY line_order
    """), {"id": str(deal_id)}).mappings().all()
    preds = session.execute(text("""
      SELECT model_name, model_version, target, value_minor, p10_minor, p90_minor, created_at
        FROM predictions WHERE deal_id = :id ORDER BY created_at DESC
    """), {"id": str(deal_id)}).mappings().all()
    return {**deal, "lines": [dict(l) for l in lines], "predictions": [dict(p) for p in preds]}


@router.get("/{deal_id}/thresholds", response_model=DealThresholdsOut)
def deal_thresholds(deal_id: UUID, target_margin: Decimal = Query(Decimal("0.20"), ge=0, lt=1),
                    tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    """Recomputes the deal from its stored inputs_snapshot (never rebuilt from today's config):
    landed cost per sellable unit across a purchase-price range, plus the sell/buy thresholds."""
    deal = _load_deal(session, deal_id)
    if not deal["inputs_snapshot"]:
        raise HTTPException(422, "deal has no inputs_snapshot")
    inp = from_json(deal["inputs_snapshot"])
    r = compute_landed(inp)
    base = inp.base_currency

    actual_sell = buy_below = None
    if deal["actual_sell_price_minor"] is not None and r.sellable_qty > 0:
        per = (Decimal(deal["actual_sell_price_minor"]) / r.sellable_qty).quantize(Decimal("1"), ROUND_HALF_UP)
        actual_sell = Money(int(per), base)
        try:
            buy_below = solve_max_purchase_price_per_input_unit(inp, actual_sell, target_margin)
        except InfeasibleTarget:
            buy_below = None

    price = inp.purchase_unit_price_major
    curve = []
    for i in range(CURVE_POINTS):
        f = Decimal(1) - CURVE_SPAN + (2 * CURVE_SPAN) * Decimal(i) / Decimal(CURVE_POINTS - 1)
        p = (price * f).quantize(Decimal("0.0001"), ROUND_HALF_UP)
        lr = compute_landed(dataclasses.replace(inp, purchase_unit_price_major=p))
        curve.append(ThresholdPoint(purchase_unit_price_major=str(p),
                                    landed_per_sellable_minor=lr.landed_cost_per_sellable_unit.amount_minor))

    return DealThresholdsOut(
        currency=inp.currency, base_currency=base, purchase_unit_price_major=str(price),
        landed_per_sellable=_money(r.landed_cost_per_sellable_unit),
        break_even_per_sellable=_money(r.break_even_per_sellable_unit),
        sell_above_threshold=_money(r.sell_above_threshold),
        actual_sell_per_sellable=_money(actual_sell) if actual_sell is not None else None,
        target_margin=str(target_margin),
        buy_below_threshold=_money(buy_below) if buy_below is not None else None, curve=curve)
