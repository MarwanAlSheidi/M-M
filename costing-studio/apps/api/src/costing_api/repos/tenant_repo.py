from __future__ import annotations

from sqlalchemy import text


def base_currency(session, tenant_id) -> str:
    ccy = session.execute(text("SELECT base_currency FROM tenants WHERE id = :t"), {"t": tenant_id}).scalar()
    if not ccy:
        raise LookupError(f"tenant {tenant_id} not found")
    return ccy
