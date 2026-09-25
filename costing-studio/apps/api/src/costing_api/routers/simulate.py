"""What-if simulator: the envelope and per-channel view for changed inputs, without storing anything.

Same service path as scripts/last_sell_price.py (envelope_service.load_inputs / load_market_prices /
resolve_rates, then costing.envelope.compute_envelope / compare_to_market per channel). The request
transaction is switched to READ ONLY before anything runs, so no snapshot or audit row can be written.
"""
from __future__ import annotations
from dataclasses import replace
from datetime import date
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from costing.envelope import MarginConfig, compare_to_market, compute_envelope
from costing.money import Money

from ..deps import get_session, get_tenant
from ..services.envelope_service import load_inputs, load_market_prices, resolve_rates

router = APIRouter(prefix="/api/v1/simulate", tags=["simulate"])

SKIPJACK = "Frozen whole skipjack tuna"   # the raw-material element the skipjack input overrides
DEFAULT_EXCLUDED_TYPES = ("retail", "import")   # applied only when the caller sends no exclude_channels
COMFORTABLE_PCT = 10                      # same verdict bands as scripts/last_sell_price.py
PCT = Decimal(100)


class SimulateRequest(BaseModel):
    product_id: UUID
    skipjack_usd: Optional[Decimal] = Field(default=None, gt=0, description="USD/kg; omit to keep the product's rate")
    margin_floor_pct: Decimal = Field(default=Decimal(15), ge=0, lt=100)
    margin_target_pct: Decimal = Field(default=Decimal(30), gt=0, lt=100)
    as_of: Optional[date] = None
    exclude_channels: Optional[list[str]] = Field(
        default=None, description="omit to exclude retail and import channels; a list (even empty) wins as given")


def verdict(headroom_pct: float) -> str:
    if headroom_pct >= COMFORTABLE_PCT:
        return "sellable_comfortable"
    return "sellable_marginal" if headroom_pct >= 0 else "not_sellable"


@router.post("")
def simulate(req: SimulateRequest, tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    session.execute(text("SET TRANSACTION READ ONLY"))
    as_of = req.as_of or date.today()
    try:
        inp = load_inputs(session, tenant["tenant_id"], req.product_id, as_of)
        if req.skipjack_usd is not None:
            if not any(e.name == SKIPJACK for e in inp.cost_elements):
                raise ValueError(f"{inp.product_name} has no {SKIPJACK!r} cost element to override")
            inp = replace(inp, cost_elements=tuple(
                replace(e, rate=Money.from_major(req.skipjack_usd, e.rate.currency)) if e.name == SKIPJACK else e
                for e in inp.cost_elements))
        max_pct = inp.margin.max_pct
        inp = replace(inp, margin=MarginConfig(req.margin_floor_pct / PCT, req.margin_target_pct / PCT, max_pct))
        env = compute_envelope(inp)
        market = load_market_prices(session, tenant["tenant_id"], req.product_id, as_of)
        extra = {p.price.currency for p in market} - set(inp.rates) - {inp.base_currency}
        rates = {**inp.rates, **(resolve_rates(session, extra, inp.base_currency, as_of) if extra else {})}
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:        # unconfigured product, bad margins (incl. target >= product max), no FX rate
        raise HTTPException(422, str(e))

    floor = env.floor_minor
    types = {r.source: r.channel_type for r in session.execute(text("""
      SELECT source, channel_type FROM market_sources WHERE tenant_id = :t AND product_id = :p
    """), {"t": tenant["tenant_id"], "p": str(req.product_id)})}
    sources = sorted({p.source for p in market})
    channel_type = {s: types.get(s, "trade") for s in sources}     # no market_sources row: column default
    if req.exclude_channels is None:
        excluded = {s for s in sources if channel_type[s] in DEFAULT_EXCLUDED_TYPES}
        exclusion = "default_by_type"
    else:
        excluded, exclusion = set(req.exclude_channels), "caller"
    channels = []
    for ch in sources:
        cmp = compare_to_market(env, [p for p in market if p.source == ch], rates)
        head = (cmp.market_reference_minor - floor) / floor * 100
        channels.append({"channel": ch, "channel_type": channel_type[ch], "market_ref_minor": cmp.market_reference_minor,
                         "headroom_pct": round(head, 1), "position": cmp.position, "verdict": verdict(head),
                         "excluded": ch in excluded})
    channels.sort(key=lambda c: c["market_ref_minor"])
    candidates = [c for c in channels if not c["excluded"] and c["verdict"] == "sellable_comfortable"]
    best = max(candidates, key=lambda c: c["headroom_pct"], default=None)

    return {
        "product_id": str(req.product_id), "product_name": inp.product_name, "as_of": as_of,
        "currency": env.currency, "unit": env.unit,
        "inputs": {"skipjack_usd": str(req.skipjack_usd) if req.skipjack_usd is not None else None,
                   "margin_floor_pct": str(req.margin_floor_pct), "margin_target_pct": str(req.margin_target_pct),
                   "margin_max_pct": str(max_pct * PCT) if max_pct is not None else None,
                   "exclude_channels": sorted(excluded), "exclusion": exclusion},
        "envelope": {"unit_cost_minor": env.unit_cost_minor, "floor_minor": floor, "target_minor": env.target_minor,
                     "ceiling_minor": env.ceiling_minor, "ceiling_source": env.ceiling_source,
                     "lines": [{"name": l.name, "amount_minor": l.amount.amount_minor} for l in env.lines]},
        "last_viable_sell_minor": floor,
        "channels": channels,
        "recommendation": best["channel"] if best else None,
    }
