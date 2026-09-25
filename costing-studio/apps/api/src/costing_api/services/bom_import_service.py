"""BOM import (Excel/CSV): upload -> map -> stage (normalize + validate) -> review -> confirm.
Each confirmed row becomes a cost element version (and its BOM quantity) via product_service."""
from __future__ import annotations
import dataclasses
import hashlib
import json
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import text

from costing.currencies import KNOWN_CURRENCIES

from . import product_service

KIND = "bom"
REQUIRED_FIELDS = {"product", "element", "unit", "rate", "currency"}
CANONICAL_FIELDS = ["product", "element", "unit", "rate", "currency", "qty_per_unit", "valid_from"]
NUMERIC_FIELDS = {"rate", "qty_per_unit"}

FIELD_SYNONYMS: dict[str, list[str]] = {
    "product": ["product", "product_name", "item", "sku"],
    "element": ["element", "cost_element", "component", "input", "material"],
    "unit": ["unit", "uom"],
    "rate": ["rate", "price", "unit_price", "cost"],
    "currency": ["ccy", "currency"],
    "qty_per_unit": ["qty", "qty_per_unit", "quantity", "usage"],
    "valid_from": ["valid_from", "effective", "date", "from"],
}

_ARABIC_INDIC = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def suggest_mapping(headers: list[str]) -> dict[str, str]:
    lower = {h.lower().strip(): h for h in headers}
    out: dict[str, str] = {}
    for field, syns in FIELD_SYNONYMS.items():
        for s in syns:
            if s in lower:
                out[field] = lower[s]
                break
    return out


def parse_file(path: Path) -> pd.DataFrame:
    ext = path.suffix.lower()
    if ext == ".xlsx":
        return pd.read_excel(path, dtype=str)
    if ext == ".csv":
        return pd.read_csv(path, dtype=str)
    raise ValueError(f"unsupported file type: {ext}")


def _clean_number(v: Any, decimal_sep: str = ".") -> str:
    s = str(v).translate(_ARABIC_INDIC).strip().replace(" ", "").replace(" ", "")
    s = s.replace("٬", "")              # Arabic thousands separator
    if "٫" in s:                          # Arabic decimal separator
        return s.replace("٫", ".")
    if decimal_sep == ",":
        return s.replace(".", "").replace(",", ".")
    return s.replace(",", "")


def normalize_row(row: dict, col_map: dict[str, str], date_format: str | None = None,
                  dayfirst: bool = False, decimal_sep: str = ".") -> dict:
    out: dict[str, Any] = {}
    for field, src in col_map.items():
        if src not in row:
            continue
        v = row[src]
        if v is None or (isinstance(v, float) and pd.isna(v)) or str(v).strip() == "":
            continue
        if field == "valid_from":
            s = str(v).strip().translate(_ARABIC_INDIC)
            try:
                out[field] = pd.to_datetime(s, format=date_format, dayfirst=dayfirst).date().isoformat()
            except Exception as e:
                raise ValueError(f"unparseable date: {s!r} ({e})")
        elif field in NUMERIC_FIELDS:
            try:
                out[field] = str(Decimal(_clean_number(v, decimal_sep)))
            except InvalidOperation:
                raise ValueError(f"{field}: not a number: {v!r}") from None
        else:
            out[field] = str(v).strip()
    return out


def fingerprint(n: dict) -> str:
    parts = [n.get(k, "") for k in ("product", "element", "valid_from", "rate", "currency", "qty_per_unit")]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


@dataclasses.dataclass
class RowResult:
    status: str               # ok | rejected
    diff_json: dict | None
    normalized: dict


def validate_row(session, tenant_id, n: dict) -> RowResult:
    """Checks one row against the tenant's products; nothing is written."""
    pid = session.execute(text("SELECT id FROM products WHERE tenant_id = :t AND name = :n"),
                          {"t": tenant_id, "n": n["product"]}).scalar()
    if pid is None:
        return RowResult("rejected", {"error": f"unknown product {n['product']!r}"}, n)
    if n["currency"] not in KNOWN_CURRENCIES:
        return RowResult("rejected", {"error": f"unknown currency {n['currency']}"}, n)
    if Decimal(n["rate"]) < 0 or Decimal(n.get("qty_per_unit", "1")) < 0:
        return RowResult("rejected", {"error": "rate and qty_per_unit must be >= 0"}, n)
    n = {**n, "product_id": str(pid), "valid_from": n.get("valid_from") or date.today().isoformat()}
    current = session.execute(text("""
      SELECT rate_minor, currency FROM cost_elements
       WHERE tenant_id = :t AND product_id = :p AND name = :e AND valid_to IS NULL
    """), {"t": tenant_id, "p": str(pid), "e": n["element"]}).mappings().first()
    return RowResult("ok", {"replaces": dict(current)} if current else None, n)


def persist_confirmed(session, tenant: dict, batch_id: str) -> dict:
    """Applies ok rows (and accepted rows) as cost-element versions. A row that conflicts with an
    existing version is marked rejected; the rest still apply (one savepoint per row)."""
    tid = tenant["tenant_id"]
    rows = session.execute(text("""
      SELECT id, row_index, normalized FROM import_rows
       WHERE tenant_id = :t AND batch_id = :b AND cost_element_id IS NULL AND status = 'ok'
       ORDER BY row_index
    """), {"t": tid, "b": batch_id}).mappings().all()
    applied, failed = 0, []
    for r in rows:
        n = dict(r["normalized"])
        try:
            with session.begin_nested():
                ce = product_service.add_cost_element(
                    session, tenant, n["product_id"], name=n["element"], unit=n["unit"],
                    rate=Decimal(n["rate"]), currency=n["currency"],
                    valid_from=date.fromisoformat(n["valid_from"]),
                    qty_per_unit=Decimal(n["qty_per_unit"]) if n.get("qty_per_unit") else None)
        except (ValueError, LookupError) as e:
            session.execute(text("""
              UPDATE import_rows SET status = 'rejected', diff_json = CAST(:d AS jsonb) WHERE id = :i
            """), {"d": json.dumps({"error": str(e)}), "i": r["id"]})
            failed.append({"row_index": r["row_index"], "error": str(e)})
            continue
        session.execute(text("UPDATE import_rows SET cost_element_id = :c WHERE id = :i"),
                        {"c": ce["id"], "i": r["id"]})
        applied += 1
    session.execute(text("""
      UPDATE import_batches SET status = 'confirmed', confirmed_at = now() WHERE tenant_id = :t AND id = :b
    """), {"t": tid, "b": batch_id})
    return {"applied": applied, "failed": failed}
