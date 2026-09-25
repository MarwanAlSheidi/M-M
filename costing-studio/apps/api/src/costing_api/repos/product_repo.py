from __future__ import annotations
from dataclasses import dataclass

from sqlalchemy import text


@dataclass(frozen=True)
class ProductRow:
    id: str
    name: str
    category: str
    base_unit: str
    attributes: dict


def get_product(session, tenant_id, product_id) -> ProductRow:
    row = session.execute(text("""
      SELECT id, name, category, base_unit, attributes FROM products WHERE tenant_id = :t AND id = :p
    """), {"t": tenant_id, "p": str(product_id)}).mappings().first()
    if not row:   # RLS makes another tenant's product look missing too
        raise LookupError(f"product {product_id} not found")
    return ProductRow(id=str(row["id"]), name=row["name"], category=row["category"],
                      base_unit=row["base_unit"], attributes=row["attributes"] or {})


def list_product_ids(session, tenant_id) -> list[str]:
    return [str(r) for r in session.execute(
        text("SELECT id FROM products WHERE tenant_id = :t ORDER BY name"), {"t": tenant_id}).scalars()]
