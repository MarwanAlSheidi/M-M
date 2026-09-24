from __future__ import annotations
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import text

from costing.money import Money


@dataclass(frozen=True)
class ProductRow:
    id: str
    sku: str
    category: str
    hs_code: str
    market_key: str
    attributes: dict[str, Any]


@dataclass(frozen=True)
class ProductCostConfig:
    default_yield: Decimal
    processing_rate: Money
    storage_rate: Money
    rate_currency: str
    default_mode: str
    kg_per_case: Decimal | None


def get_product(session, tenant_id, sku) -> ProductRow:
    row = session.execute(text("""
      SELECT id, sku, category, hs_code, market_key, attributes
        FROM products WHERE tenant_id = :t AND sku = :s
    """), {"t": tenant_id, "s": sku}).mappings().first()
    if not row:
        raise LookupError(f"product {sku} not found for tenant")
    return ProductRow(id=str(row["id"]), sku=row["sku"], category=row["category"],
                      hs_code=row["hs_code"], market_key=row["market_key"],
                      attributes=row["attributes"] or {})


def get_cost_config(session, tenant_id, sku, as_of: date) -> ProductCostConfig:
    row = session.execute(text("""
      SELECT pcc.default_yield, pcc.processing_rate_minor, pcc.storage_rate_minor_per_unit_day,
             pcc.rate_currency, pcc.default_mode, pcc.kg_per_case
        FROM product_cost_config pcc JOIN products p ON p.id = pcc.product_id
       WHERE pcc.tenant_id = :t AND p.sku = :s
         AND pcc.valid_from <= :d AND (pcc.valid_to IS NULL OR pcc.valid_to > :d)
       ORDER BY pcc.valid_from DESC LIMIT 1
    """), {"t": tenant_id, "s": sku, "d": as_of}).mappings().first()
    if not row:
        raise LookupError(f"product_cost_config missing for {sku} on {as_of}")
    ccy = row["rate_currency"]
    return ProductCostConfig(
        default_yield=Decimal(str(row["default_yield"])),
        processing_rate=Money(int(row["processing_rate_minor"]), ccy),
        storage_rate=Money(int(row["storage_rate_minor_per_unit_day"]), ccy),
        rate_currency=ccy, default_mode=row["default_mode"],
        kg_per_case=Decimal(str(row["kg_per_case"])) if row["kg_per_case"] is not None else None,
    )
