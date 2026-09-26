"""Shared plumbing for scripts/load_*.py: a tenant-scoped transaction as costing_app (the API's
role, so RLS applies), exact-money checks, and a readable envelope printout."""
from __future__ import annotations
import os
import sys
from decimal import Decimal

DEFAULT_TENANT = "11111111-1111-1111-1111-111111111111"   # the seeded example tenant


class LoadError(Exception):
    pass


def _settings_env() -> None:
    # costing_api.settings requires these; loaders never issue tokens or touch Redis.
    os.environ.setdefault("JWT_SECRET", "unused-by-loaders")
    if not os.environ.get("DATABASE_URL"):
        sys.exit("DATABASE_URL must point at the costing DB as costing_app, e.g. "
                 "postgresql+psycopg://costing_app:app_pw@localhost:5432/costing")


def run_in_tenant(tenant_id: str, fn):
    """fn(session, tenant) inside one transaction with app.tenant_id set; rolls back on any error."""
    _settings_env()
    from costing_api.jobs.base import tenant_session
    tenant = {"tenant_id": tenant_id, "user_id": None, "role": "admin"}
    try:
        with tenant_session(tenant_id) as s:
            return fn(s, tenant)
    except LoadError as e:
        sys.exit(f"error: {e}")
    except (ValueError, LookupError) as e:          # service-layer validation, unknown product, conflicts
        sys.exit(f"error: {e}")


def check_exact(amount: Decimal, currency: str, what: str) -> None:
    """Refuse amounts that don't fit the currency's minor unit instead of silently rounding them
    (rates are stored as integer minor units)."""
    from costing.currencies import KNOWN_CURRENCIES, exponent_of
    if currency not in KNOWN_CURRENCIES:
        raise LoadError(f"{what}: unknown currency {currency}")
    exp = exponent_of(currency)
    if amount != amount.quantize(Decimal(1).scaleb(-exp)):
        raise LoadError(f"{what}: {amount} {currency} has more than {exp} decimals and would be rounded. "
                        f"Quote it per a larger unit (e.g. per MWh instead of per kWh) and scale qty_per_unit.")


def resolve_product(session, tenant: dict, product: str) -> str:
    from sqlalchemy import text
    row = session.execute(text("""
      SELECT id FROM products WHERE tenant_id = :t AND (name = :p OR CAST(id AS text) = :p)
    """), {"t": tenant["tenant_id"], "p": product}).scalar()
    if row is None:
        raise LoadError(f"no product named or with id {product!r} in tenant {tenant['tenant_id']}")
    return str(row)


def print_envelope(session, tenant: dict, product_id: str, computed_by: str, save: bool = True) -> None:
    """Compute and print the envelope. save=False is a preview: the snapshot insert is rolled back, so
    nothing lands in pricing_snapshots (a snapshot means someone computed the envelope for a reason)."""
    from costing.currencies import exponent_of
    from costing.money import Money
    from costing_api.services.envelope_service import EnvelopeNotConfigured, build_envelope
    try:
        if save:
            e = build_envelope(session, tenant["tenant_id"], product_id, computed_by=computed_by)
        else:
            preview = session.begin_nested()
            try:
                e = build_envelope(session, tenant["tenant_id"], product_id, computed_by=computed_by)
            finally:
                preview.rollback()
    except EnvelopeNotConfigured as err:
        print(f"envelope not computed: {err}")
        return
    exp = exponent_of(e["currency"])
    m = lambda v: f"{Money(int(v), e['currency']).major:.{exp}f} {e['currency']}"    # noqa: E731  full decimals
    saved = f"snapshot {e['snapshot_id']}" if save else "preview, not saved"
    print(f"\nenvelope per {e['unit']} (as of {e['as_of']}, {saved}):")
    for line in e["lines"]:
        print(f"  {line['name']:<28} {m(line['amount_minor']):>16}")
    print(f"  {'unit cost':<28} {m(e['unit_cost_minor']):>16}")
    print(f"  {'floor':<28} {m(e['floor_minor']):>16}")
    print(f"  {'target':<28} {m(e['target_minor']):>16}")
    print(f"  {'ceiling (' + e['ceiling_source'] + ')':<28} {m(e['ceiling_minor']):>16}")
    mk = e["market"]
    if mk:
        print(f"  {'market reference':<28} {m(mk['market_reference_minor']):>16}  "
              f"[{mk['position']}]  sources: {', '.join(mk['sources_used'])}")
        print(f"  gaps: floor {m(mk['gap_to_floor'])} · target {m(mk['gap_to_target'])} · "
              f"ceiling {m(mk['gap_to_ceiling'])}")
    else:
        print("  market: no fresh prices")
