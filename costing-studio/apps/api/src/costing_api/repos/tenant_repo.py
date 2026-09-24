from __future__ import annotations
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import text


@dataclass(frozen=True)
class TenantCostConfig:
    base_currency: str
    dest_country: str
    vat_rate: Decimal
    vat_recoverable: bool
    wacc: Decimal
    overhead_pct: Decimal
    customer_days: int
    supplier_terms_days: int
    default_storage_days: int
    landed_scope: list


def get_cost_config(session, tenant_id, as_of: date) -> TenantCostConfig:
    row = session.execute(text("""
      SELECT base_currency, dest_country, vat_rate, vat_recoverable, wacc, overhead_pct,
             customer_days, supplier_terms_days, default_storage_days, landed_scope
        FROM tenant_cost_config
       WHERE tenant_id = :t AND valid_from <= :d AND (valid_to IS NULL OR valid_to > :d)
       ORDER BY valid_from DESC LIMIT 1
    """), {"t": tenant_id, "d": as_of}).mappings().first()
    if not row:
        raise LookupError(f"tenant_cost_config missing for {tenant_id} on {as_of}")
    return TenantCostConfig(
        base_currency=row["base_currency"], dest_country=row["dest_country"],
        vat_rate=Decimal(str(row["vat_rate"])), vat_recoverable=row["vat_recoverable"],
        wacc=Decimal(str(row["wacc"])), overhead_pct=Decimal(str(row["overhead_pct"])),
        customer_days=row["customer_days"], supplier_terms_days=row["supplier_terms_days"],
        default_storage_days=row["default_storage_days"], landed_scope=list(row["landed_scope"]),
    )
