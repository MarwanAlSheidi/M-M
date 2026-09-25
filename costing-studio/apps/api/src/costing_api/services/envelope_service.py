"""build_envelope + compare_to_market over DB rows. Every computation is stored as a
pricing_snapshot (inputs included), so audit and ML read it back instead of rebuilding inputs."""
from __future__ import annotations
import json
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Optional

from sqlalchemy import text

from costing.envelope import (
    CostElement, EnvelopeInputs, MarginConfig, MarketPrice, compare_to_market, compute_envelope,
    envelope_to_json, inputs_from_json, inputs_to_json,
)
from costing.fx import FxResolver
from costing.money import Money

from ..repos import market_repo, product_repo, tenant_repo

# Market prices from a source with no market_sources row (e.g. a one-off CSV) count for this long.
DEFAULT_STALENESS_DAYS = 30


class EnvelopeNotConfigured(ValueError):
    """Product lacks cost elements or a margin config on the requested date."""


def resolve_rates(session, currencies: set[str], base: str, as_of: date) -> dict[str, Decimal]:
    """1 unit of ccy = rate x base. Pegs are hardcoded in FxResolver; others come from fx_rates."""
    market = {}
    for c in currencies - {"USD", base}:
        r = market_repo.latest_fx_rate(session, c, "USD", as_of)
        if r is not None:
            market[f"{c}/USD"] = r
    if base != "USD":
        r = market_repo.latest_fx_rate(session, base, "USD", as_of)
        if r is not None:
            market[f"USD/{base}"] = Decimal(1) / r
    resolver = FxResolver(market)
    out = {}
    for c in currencies - {base}:
        try:
            out[c] = resolver.rate(c, base)
        except ValueError:
            raise EnvelopeNotConfigured(f"no fx rate {c} -> {base} on file") from None
    return out


def load_inputs(session, tenant_id, product_id, as_of: date) -> EnvelopeInputs:
    product = product_repo.get_product(session, tenant_id, product_id)
    base = tenant_repo.base_currency(session, tenant_id)
    rows = session.execute(text("""
      SELECT ce.name, ce.unit, ce.rate_minor, ce.currency, COALESCE(b.qty_per_unit, 1) AS qty
        FROM cost_elements ce LEFT JOIN product_bom b ON b.cost_element_id = ce.id
       WHERE ce.tenant_id = :t AND ce.product_id = :p
         AND ce.valid_from <= :d AND (ce.valid_to IS NULL OR ce.valid_to > :d)
       ORDER BY ce.name
    """), {"t": tenant_id, "p": product.id, "d": as_of}).mappings().all()
    if not rows:
        raise EnvelopeNotConfigured(f"{product.name}: no cost elements valid on {as_of}")
    m = session.execute(text("""
      SELECT min_pct, target_pct, max_pct FROM margin_config
       WHERE tenant_id = :t AND product_id = :p
         AND valid_from <= :d AND (valid_to IS NULL OR valid_to > :d)
    """), {"t": tenant_id, "p": product.id, "d": as_of}).mappings().first()
    if not m:
        raise EnvelopeNotConfigured(f"{product.name}: no margin config valid on {as_of}")
    elements = tuple(CostElement(name=r["name"], unit=r["unit"], rate=Money(int(r["rate_minor"]), r["currency"]),
                                 qty_per_unit=Decimal(str(r["qty"]))) for r in rows)
    margin = MarginConfig(min_pct=Decimal(str(m["min_pct"])), target_pct=Decimal(str(m["target_pct"])),
                          max_pct=Decimal(str(m["max_pct"])) if m["max_pct"] is not None else None)
    return EnvelopeInputs(product_name=product.name, base_unit=product.base_unit, base_currency=base,
                          cost_elements=elements, margin=margin, as_of=as_of,
                          rates=resolve_rates(session, {e.rate.currency for e in elements}, base, as_of))


def load_market_prices(session, tenant_id, product_id, as_of: date) -> list[MarketPrice]:
    """Observations on or before as_of that are still fresh for their source."""
    rows = session.execute(text("""
      SELECT mp.source, mp.price_minor, mp.currency, mp.unit, mp.observed_at,
             COALESCE(ms.staleness_days, :dflt) AS staleness_days
        FROM market_prices mp
        LEFT JOIN market_sources ms
          ON ms.tenant_id = mp.tenant_id AND ms.product_id = mp.product_id AND ms.source = mp.source
       WHERE mp.tenant_id = :t AND mp.product_id = :p AND mp.observed_at <= :d
         AND COALESCE(ms.active, true)
    """), {"t": tenant_id, "p": str(product_id), "d": as_of, "dflt": DEFAULT_STALENESS_DAYS}).mappings().all()
    return [MarketPrice(source=r["source"], price=Money(int(r["price_minor"]), r["currency"]), unit=r["unit"],
                        observed_at=r["observed_at"])
            for r in rows if r["observed_at"] > as_of - timedelta(days=int(r["staleness_days"]))]


def build_envelope(session, tenant_id, product_id, as_of: Optional[date] = None,
                   computed_by: str = "api") -> dict:
    as_of = as_of or date.today()
    inp = load_inputs(session, tenant_id, product_id, as_of)
    env = compute_envelope(inp)

    market = load_market_prices(session, tenant_id, product_id, as_of)
    comparison = None
    if market:
        extra = {p.price.currency for p in market} - set(inp.rates) - {inp.base_currency}
        rates = {**inp.rates, **(resolve_rates(session, extra, inp.base_currency, as_of) if extra else {})}
        comparison = compare_to_market(env, market, rates)
        inp = EnvelopeInputs(**{**inp.__dict__, "rates": rates})

    snap = {"inputs": inputs_to_json(inp),
            "market": [{"source": p.source, "price_minor": p.price.amount_minor, "currency": p.price.currency,
                        "unit": p.unit, "observed_at": p.observed_at.isoformat()} for p in market]}
    snapshot_id = session.execute(text("""
      INSERT INTO pricing_snapshots (tenant_id, product_id, computed_by, currency, unit_cost_minor,
                                     floor_minor, target_minor, ceiling_minor, market_reference_minor,
                                     position, inputs_snapshot)
      VALUES (:t, :p, :by, :c, :uc, :f, :tg, :cl, :mr, :pos, CAST(:snap AS jsonb))
      RETURNING id, computed_at
    """), {"t": tenant_id, "p": str(product_id), "by": computed_by, "c": env.currency,
           "uc": env.unit_cost_minor, "f": env.floor_minor, "tg": env.target_minor, "cl": env.ceiling_minor,
           "mr": comparison.market_reference_minor if comparison else None,
           "pos": comparison.position if comparison else None, "snap": json.dumps(snap)}).one()
    return _out(product_id, snapshot_id.id, snapshot_id.computed_at, as_of, envelope_to_json(env), comparison)


def _out(product_id, snapshot_id, computed_at, as_of, env: dict, comparison) -> dict:
    return {
        "product_id": str(product_id), "snapshot_id": str(snapshot_id), "computed_at": computed_at,
        "as_of": as_of, **env,
        "market": None if comparison is None else {
            "position": comparison.position, "market_reference_minor": comparison.market_reference_minor,
            "gap_to_floor": comparison.gap_to_floor, "gap_to_target": comparison.gap_to_target,
            "gap_to_ceiling": comparison.gap_to_ceiling, "sources_used": list(comparison.sources_used),
        },
    }


def latest_snapshot(session, tenant_id, product_id) -> Optional[dict]:
    r = session.execute(text("""
      SELECT id, computed_at, computed_by, currency, unit_cost_minor, floor_minor, target_minor,
             ceiling_minor, market_reference_minor, position, inputs_snapshot
        FROM pricing_snapshots WHERE tenant_id = :t AND product_id = :p
       ORDER BY computed_at DESC LIMIT 1
    """), {"t": tenant_id, "p": str(product_id)}).mappings().first()
    if r is None:
        return None
    inp = inputs_from_json(r["inputs_snapshot"]["inputs"])
    env = envelope_to_json(compute_envelope(inp))     # lines recomputed from the stored inputs
    comparison = None
    if r["position"] is not None:
        comparison = SimpleNamespace(
            position=r["position"], market_reference_minor=int(r["market_reference_minor"]),
            gap_to_floor=int(r["market_reference_minor"]) - int(r["floor_minor"]),
            gap_to_target=int(r["market_reference_minor"]) - int(r["target_minor"]),
            gap_to_ceiling=int(r["market_reference_minor"]) - int(r["ceiling_minor"]),
            sources_used=tuple(sorted({m["source"] for m in r["inputs_snapshot"].get("market", [])})))
    out = _out(product_id, r["id"], r["computed_at"], inp.as_of, env, comparison)
    out["computed_by"] = r["computed_by"]
    return out
