"""Products, cost elements and margin config: the only writes that shape an envelope.
Admin-only (enforced by the routers); every write lands in audit_log.

Versioning: cost elements (per name) and margin config are dated rows. Posting a new version
closes the currently open one at the new valid_from; its BOM quantity carries over unless a
new qty_per_unit is given."""
from __future__ import annotations
import json
from datetime import date
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import text

from costing.currencies import KNOWN_CURRENCIES
from costing.envelope import MarginConfig
from costing.money import Money


class Conflict(ValueError):
    """Maps to HTTP 409."""


def _audit(session, tenant: dict, entity: str, entity_id, action: str, diff: dict) -> None:
    session.execute(text("""
      INSERT INTO audit_log (tenant_id, user_id, entity, entity_id, action, diff)
      VALUES (:t, :u, :e, :id, :a, CAST(:d AS jsonb))
    """), {"t": tenant["tenant_id"], "u": tenant["user_id"], "e": entity, "id": str(entity_id),
           "a": action, "d": json.dumps(diff, default=str)})


def _require_product(session, tenant_id, product_id) -> None:
    if not session.execute(text("SELECT 1 FROM products WHERE tenant_id = :t AND id = :p"),
                           {"t": tenant_id, "p": str(product_id)}).first():
        raise LookupError(f"product {product_id} not found")


# ------------------------------------------------------------------ products
def list_products(session, tenant_id) -> list[dict]:
    rows = session.execute(text("""
      SELECT p.id, p.name, p.category, p.base_unit, p.attributes,
             s.computed_at, s.currency, s.floor_minor, s.target_minor, s.ceiling_minor,
             s.market_reference_minor, s.position
        FROM products p
        LEFT JOIN LATERAL (
          SELECT computed_at, currency, floor_minor, target_minor, ceiling_minor,
                 market_reference_minor, position
            FROM pricing_snapshots ps WHERE ps.tenant_id = p.tenant_id AND ps.product_id = p.id
           ORDER BY computed_at DESC LIMIT 1) s ON true
       WHERE p.tenant_id = :t ORDER BY p.name
    """), {"t": tenant_id}).mappings().all()
    return [dict(r) for r in rows]


def create_product(session, tenant: dict, name: str, category: str, base_unit: str,
                   attributes: Optional[dict] = None) -> dict:
    if session.execute(text("SELECT 1 FROM products WHERE tenant_id = :t AND name = :n"),
                       {"t": tenant["tenant_id"], "n": name}).first():
        raise Conflict(f"product {name!r} already exists")
    row = session.execute(text("""
      INSERT INTO products (tenant_id, name, category, base_unit, attributes)
      VALUES (:t, :n, :c, :u, CAST(:a AS jsonb))
      RETURNING id, name, category, base_unit, attributes, created_at
    """), {"t": tenant["tenant_id"], "n": name, "c": category, "u": base_unit,
           "a": json.dumps(attributes or {})}).mappings().one()
    _audit(session, tenant, "product", row["id"], "create", dict(row))
    return dict(row)


def update_product(session, tenant: dict, product_id, patch: dict[str, Any]) -> dict:
    _require_product(session, tenant["tenant_id"], product_id)
    allowed = {k: v for k, v in patch.items() if k in ("name", "category", "base_unit", "attributes") and v is not None}
    if not allowed:
        raise ValueError("nothing to update")
    if "name" in allowed and session.execute(text(
            "SELECT 1 FROM products WHERE tenant_id = :t AND name = :n AND id <> :p"),
            {"t": tenant["tenant_id"], "n": allowed["name"], "p": str(product_id)}).first():
        raise Conflict(f"product {allowed['name']!r} already exists")
    sets = ", ".join(f"{k} = CAST(:{k} AS jsonb)" if k == "attributes" else f"{k} = :{k}" for k in allowed)
    params = {**allowed, "t": tenant["tenant_id"], "p": str(product_id)}
    if "attributes" in params:
        params["attributes"] = json.dumps(params["attributes"])
    row = session.execute(text(f"""
      UPDATE products SET {sets} WHERE tenant_id = :t AND id = :p
      RETURNING id, name, category, base_unit, attributes, created_at
    """), params).mappings().one()
    _audit(session, tenant, "product", product_id, "update", allowed)
    return dict(row)


def product_detail(session, tenant_id, product_id, as_of: Optional[date] = None) -> dict:
    as_of = as_of or date.today()
    p = session.execute(text("""
      SELECT id, name, category, base_unit, attributes, created_at FROM products WHERE tenant_id = :t AND id = :p
    """), {"t": tenant_id, "p": str(product_id)}).mappings().first()
    if p is None:
        raise LookupError(f"product {product_id} not found")
    q = {"t": tenant_id, "p": str(product_id), "d": as_of}
    elements = session.execute(text("""
      SELECT ce.id, ce.name, ce.unit, ce.rate_minor, ce.currency, ce.valid_from, ce.valid_to,
             b.qty_per_unit,
             (ce.valid_from <= :d AND (ce.valid_to IS NULL OR ce.valid_to > :d)) AS current
        FROM cost_elements ce LEFT JOIN product_bom b ON b.cost_element_id = ce.id
       WHERE ce.tenant_id = :t AND ce.product_id = :p ORDER BY ce.name, ce.valid_from DESC
    """), q).mappings().all()
    margins = session.execute(text("""
      SELECT id, min_pct, target_pct, max_pct, valid_from, valid_to,
             (valid_from <= :d AND (valid_to IS NULL OR valid_to > :d)) AS current
        FROM margin_config WHERE tenant_id = :t AND product_id = :p ORDER BY valid_from DESC
    """), q).mappings().all()
    sources = session.execute(text("""
      SELECT id, source, url, parser, frequency, staleness_days, active
        FROM market_sources WHERE tenant_id = :t AND product_id = :p ORDER BY source
    """), q).mappings().all()
    prices = session.execute(text("""
      SELECT source, price_minor, currency, unit, observed_at FROM market_prices
       WHERE tenant_id = :t AND product_id = :p ORDER BY observed_at DESC, source LIMIT 50
    """), q).mappings().all()
    return {**dict(p), "cost_elements": [dict(e) for e in elements], "margin_configs": [dict(m) for m in margins],
            "market_sources": [dict(s) for s in sources], "market_prices": [dict(x) for x in prices]}


# ------------------------------------------------------------------ versioned rows
def _close_open_version(session, table: str, where: str, params: dict, valid_from: date):
    open_row = session.execute(text(f"""
      SELECT id, valid_from FROM {table} WHERE {where} AND valid_to IS NULL
    """), params).mappings().first()
    later = session.execute(text(f"""
      SELECT 1 FROM {table} WHERE {where} AND valid_from >= :vf
    """), {**params, "vf": valid_from}).first()
    if later:
        raise Conflict(f"a {table} version starting on or after {valid_from} already exists")
    if open_row:
        session.execute(text(f"UPDATE {table} SET valid_to = :vf WHERE id = :id"),
                        {"vf": valid_from, "id": open_row["id"]})
    return open_row


def _replaceable_same_day(session, table: str, where: str, params: dict, valid_from: date):
    """The open version, if it starts on valid_from and no pricing snapshot for the product has been computed
    since it started (so nothing has used it yet): such a version is corrected in place instead of refused."""
    open_row = session.execute(text(f"""
      SELECT id, valid_from FROM {table} WHERE {where} AND valid_to IS NULL
    """), params).mappings().first()
    if open_row is None or open_row["valid_from"] != valid_from:
        return None
    used = session.execute(text("""
      SELECT 1 FROM pricing_snapshots WHERE tenant_id = :t AND product_id = :p AND computed_at >= :vf LIMIT 1
    """), {"t": params["t"], "p": params["p"], "vf": valid_from}).first()
    return None if used else open_row


def add_cost_element(session, tenant: dict, product_id, name: str, unit: str, rate: Decimal, currency: str,
                     valid_from: date, qty_per_unit: Optional[Decimal] = None) -> dict:
    tid = tenant["tenant_id"]
    _require_product(session, tid, product_id)
    if currency not in KNOWN_CURRENCIES:
        raise ValueError(f"unknown currency {currency}")
    if rate < 0 or (qty_per_unit is not None and qty_per_unit < 0):
        raise ValueError("rate and qty_per_unit must be >= 0")
    rate_minor = Money.from_major(rate, currency).amount_minor
    where = "tenant_id = :t AND product_id = :p AND name = :n"
    same_day = _replaceable_same_day(session, "cost_elements", where,
                                     {"t": tid, "p": str(product_id), "n": name}, valid_from)
    if same_day is not None:
        row = session.execute(text("""
          UPDATE cost_elements SET unit = :u, rate_minor = :r, currency = :c WHERE id = :id
          RETURNING id, name, unit, rate_minor, currency, valid_from, valid_to
        """), {"u": unit, "r": rate_minor, "c": currency, "id": same_day["id"]}).mappings().one()
        if qty_per_unit is not None:
            updated = session.execute(text("UPDATE product_bom SET qty_per_unit = :q WHERE cost_element_id = :c"),
                                      {"q": qty_per_unit, "c": row["id"]}).rowcount
            if not updated:
                session.execute(text("""
                  INSERT INTO product_bom (tenant_id, product_id, cost_element_id, qty_per_unit)
                  VALUES (:t, :p, :c, :q)
                """), {"t": tid, "p": str(product_id), "c": row["id"], "q": qty_per_unit})
        out = {**dict(row), "qty_per_unit": qty_per_unit, "replaced_id": None, "updated_in_place": True}
        _audit(session, tenant, "cost_element", row["id"], "update", out)
        return out
    prev = _close_open_version(session, "cost_elements", where,
                               {"t": tid, "p": str(product_id), "n": name}, valid_from)
    if qty_per_unit is None and prev is not None:
        q = session.execute(text("SELECT qty_per_unit FROM product_bom WHERE cost_element_id = :c"),
                            {"c": prev["id"]}).scalar()
        qty_per_unit = Decimal(str(q)) if q is not None else None
    row = session.execute(text("""
      INSERT INTO cost_elements (tenant_id, product_id, name, unit, rate_minor, currency, valid_from)
      VALUES (:t, :p, :n, :u, :r, :c, :vf)
      RETURNING id, name, unit, rate_minor, currency, valid_from, valid_to
    """), {"t": tid, "p": str(product_id), "n": name, "u": unit, "r": rate_minor, "c": currency,
           "vf": valid_from}).mappings().one()
    if qty_per_unit is not None:
        session.execute(text("""
          INSERT INTO product_bom (tenant_id, product_id, cost_element_id, qty_per_unit)
          VALUES (:t, :p, :c, :q)
        """), {"t": tid, "p": str(product_id), "c": row["id"], "q": qty_per_unit})
    out = {**dict(row), "qty_per_unit": qty_per_unit,
           "replaced_id": str(prev["id"]) if prev else None}
    _audit(session, tenant, "cost_element", row["id"], "create", out)
    return out


def set_margin_config(session, tenant: dict, product_id, min_pct: Decimal, target_pct: Decimal,
                      max_pct: Optional[Decimal], valid_from: date) -> dict:
    tid = tenant["tenant_id"]
    _require_product(session, tid, product_id)
    MarginConfig(min_pct, target_pct, max_pct)            # same validation as the engine
    same_day = _replaceable_same_day(session, "margin_config", "tenant_id = :t AND product_id = :p",
                                     {"t": tid, "p": str(product_id)}, valid_from)
    if same_day is not None:
        row = session.execute(text("""
          UPDATE margin_config SET min_pct = :mn, target_pct = :tg, max_pct = :mx WHERE id = :id
          RETURNING id, min_pct, target_pct, max_pct, valid_from, valid_to
        """), {"mn": min_pct, "tg": target_pct, "mx": max_pct, "id": same_day["id"]}).mappings().one()
        out = {**dict(row), "replaced_id": None, "updated_in_place": True}
        _audit(session, tenant, "margin_config", row["id"], "update", out)
        return out
    prev = _close_open_version(session, "margin_config", "tenant_id = :t AND product_id = :p",
                               {"t": tid, "p": str(product_id)}, valid_from)
    row = session.execute(text("""
      INSERT INTO margin_config (tenant_id, product_id, min_pct, target_pct, max_pct, valid_from)
      VALUES (:t, :p, :mn, :tg, :mx, :vf)
      RETURNING id, min_pct, target_pct, max_pct, valid_from, valid_to
    """), {"t": tid, "p": str(product_id), "mn": min_pct, "tg": target_pct, "mx": max_pct,
           "vf": valid_from}).mappings().one()
    out = {**dict(row), "replaced_id": str(prev["id"]) if prev else None}
    _audit(session, tenant, "margin_config", row["id"], "create", out)
    return out
