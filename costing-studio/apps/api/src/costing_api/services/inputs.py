from __future__ import annotations
from decimal import Decimal

from costing.fx import FxResolver
from costing.models import DealInputs
from costing.money import Money

from ..repos import hs_repo, lane_repo, market_repo, product_repo, tenant_repo


def resolve_locked_rates(session, currencies: set[str], base: str, as_of) -> dict[str, Decimal]:
    """Pegs are hardcoded in FxResolver; non-pegged currencies come from global fx_rates."""
    market = {}
    for c in currencies - {"USD"}:
        r = market_repo.latest_fx_rate(session, c, "USD", as_of)
        if r is not None:
            market[f"{c}/USD"] = r
    resolver = FxResolver(market)
    return {c: resolver.rate(c, base) for c in currencies}


def build_inputs(session, tenant_id, req) -> DealInputs:
    as_of = req.deal_date
    tenant_cfg = tenant_repo.get_cost_config(session, tenant_id, as_of)
    product = product_repo.get_product(session, tenant_id, req.product_sku)
    product_cfg = product_repo.get_cost_config(session, tenant_id, req.product_sku, as_of)
    base = tenant_cfg.base_currency

    if product_cfg.rate_currency != base:
        raise ValueError(f"product_cost_config.rate_currency {product_cfg.rate_currency} "
                         f"must equal tenant base currency {base}")

    origin = getattr(req, "origin_country", None) or product.attributes.get("origin_country")
    if not origin:
        raise ValueError(f"cannot resolve origin_country for {product.sku}")
    dest = getattr(req, "dest_country", None) or tenant_cfg.dest_country

    duty_rate = hs_repo.get_duty_rate(session, hs_code=product.hs_code, import_country=dest,
                                      origin_country=origin, on_date=as_of)
    lane = lane_repo.get_lane_cost(session, tenant_id, origin, dest, product_cfg.default_mode, as_of)

    currencies = {req.currency, req.freight_currency, "USD", base, lane.clearing_fixed.currency}
    locked = resolve_locked_rates(session, currencies, base, as_of)

    freight = (Money.from_major(req.freight_total_major, req.freight_currency)
               if req.freight_total_major else Money(0, req.freight_currency))

    def pick(override, default):
        return override if override is not None else default

    return DealInputs(
        product_sku=req.product_sku,
        quantity=Decimal(req.quantity),
        base_unit=req.base_unit,
        yield_pct=Decimal(req.yield_pct) if req.yield_pct else product_cfg.default_yield,
        purchase_unit_price_major=req.purchase_unit_price_major or Decimal("0"),
        currency=req.currency,
        incoterm=req.incoterm,
        freight_total=freight,
        hs_code=product.hs_code,
        duty_rate=duty_rate,
        vat_rate=tenant_cfg.vat_rate,
        vat_recoverable=tenant_cfg.vat_recoverable,
        clearing_fixed=lane.clearing_fixed,
        processing_rate_per_unit=product_cfg.processing_rate,
        storage_days=pick(req.storage_days, tenant_cfg.default_storage_days),
        storage_rate_per_unit_day=product_cfg.storage_rate,
        days_to_customer_payment=pick(req.days_to_customer_payment, tenant_cfg.customer_days),
        supplier_terms_days=pick(req.supplier_terms_days, tenant_cfg.supplier_terms_days),
        wacc=pick(req.wacc, tenant_cfg.wacc),
        overhead_pct=pick(req.overhead_pct, tenant_cfg.overhead_pct),
        min_margin=Decimal(req.min_margin),
        locked_rates=locked,
        base_currency=base,
        deal_date=as_of,
    )
