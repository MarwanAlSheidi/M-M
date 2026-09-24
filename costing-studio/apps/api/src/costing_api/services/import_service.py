"""Excel/CSV import: upload -> map -> stage (normalize + recompute + flag) -> review -> confirm."""
from __future__ import annotations
import dataclasses
import hashlib
import json
import uuid
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import text

from costing import serialize
from costing.currencies import exponent_of
from costing.engine import compute_landed
from costing.money import Money

from ..repos import product_repo, tenant_repo
from ..schemas import QuoteRequest
from .inputs import build_inputs

DIVERGENCE_THRESHOLD = Decimal("0.01")
REQUIRED_FIELDS = {"sku", "quantity", "deal_date", "purchase_unit_price_major"}

CANONICAL_FIELDS = [
    "sku", "supplier_name", "buyer_name", "quantity", "base_unit", "incoterm",
    "origin_country", "dest_country", "deal_date", "currency", "purchase_unit_price_major",
    "freight_total_major", "freight_currency", "actual_landed_cost_major",
    "actual_sell_price_major", "recorded_currency", "yield_pct", "hs_code",
    "overhead_pct", "wacc", "insurance_rate", "supplier_terms_days", "days_to_customer_payment", "storage_days",
    "recorded_freight_major", "recorded_duty_major",
]
NUMERIC_FIELDS = {
    "quantity", "purchase_unit_price_major", "freight_total_major", "actual_landed_cost_major",
    "actual_sell_price_major", "yield_pct", "overhead_pct", "wacc", "insurance_rate", "supplier_terms_days",
    "days_to_customer_payment", "storage_days", "recorded_freight_major", "recorded_duty_major",
}
INT_FIELDS = {"supplier_terms_days", "days_to_customer_payment", "storage_days"}

FIELD_SYNONYMS: dict[str, list[str]] = {
    "sku": ["sku", "item", "product_code", "part_number"],
    "supplier_name": ["supplier", "vendor", "shipper"],
    "quantity": ["qty", "quantity", "net_weight", "weight"],
    "base_unit": ["unit", "uom"],
    "incoterm": ["incoterm", "terms"],
    "origin_country": ["origin", "country_of_origin", "coo"],
    "dest_country": ["destination", "dest"],
    "deal_date": ["date", "invoice_date", "deal_date", "ship_date"],
    "currency": ["ccy", "currency"],
    "purchase_unit_price_major": ["price", "unit_price", "purchase_price", "ppu"],
    "freight_total_major": ["freight", "freight_total", "shipping"],
    "actual_landed_cost_major": ["landed", "total_cost", "landed_cost"],
    "actual_sell_price_major": ["sell", "selling", "sell_price", "actual_sell"],
    "yield_pct": ["yield"],
    "hs_code": ["hs", "hs_code", "hts"],
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
    s = str(v).translate(_ARABIC_INDIC).strip().replace(" ", "").replace("\u00a0", "")
    s = s.replace("\u066c", "")              # Arabic thousands separator
    if "\u066b" in s:                          # Arabic decimal separator
        return s.replace("\u066b", ".")
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
        if field == "deal_date":
            s = str(v).strip().translate(_ARABIC_INDIC)
            try:
                out[field] = pd.to_datetime(s, format=date_format, dayfirst=dayfirst).date().isoformat()
            except Exception as e:
                raise ValueError(f"unparseable date: {s!r} ({e})")
        elif field in NUMERIC_FIELDS:
            num = Decimal(_clean_number(v, decimal_sep))
            out[field] = str(int(num)) if field in INT_FIELDS else str(num)
        else:
            out[field] = str(v).strip()
    return out


def fingerprint(n: dict) -> str:
    parts = [n.get(k, "") for k in ("sku", "deal_date", "quantity", "purchase_unit_price_major", "supplier_name")]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


def to_quote_request(n: dict) -> QuoteRequest:
    kw = dict(
        product_sku=n["sku"], quantity=n["quantity"], base_unit=n.get("base_unit", "kg"),
        currency=n.get("currency", "USD"), incoterm=n.get("incoterm", "CFR"),
        freight_currency=n.get("freight_currency", "USD"),
        origin_country=n.get("origin_country"), dest_country=n.get("dest_country"),
        deal_date=date.fromisoformat(n["deal_date"]), yield_pct=n.get("yield_pct"),
        purchase_unit_price_major=Decimal(n["purchase_unit_price_major"]),
        freight_total_major=n.get("freight_total_major"), use_ml=False,
    )
    for k in ("overhead_pct", "wacc", "insurance_rate"):
        if n.get(k) is not None:
            kw[k] = Decimal(n[k])
    for k in ("supplier_terms_days", "days_to_customer_payment", "storage_days"):
        if n.get(k) is not None:
            kw[k] = int(n[k])
    return QuoteRequest(**kw)


def to_base_minor(major, frm_ccy: str, base_ccy: str, locked: dict) -> int | None:
    if major is None:
        return None
    money = Money.from_major(major, frm_ccy)
    if frm_ccy == base_ccy:
        return money.amount_minor
    if frm_ccy not in locked:
        raise ValueError(f"no locked rate for {frm_ccy}")
    scale = Decimal(10) ** (exponent_of(base_ccy) - exponent_of(frm_ccy))
    return int((Decimal(money.amount_minor) * Decimal(locked[frm_ccy]) * scale)
               .quantize(Decimal("1"), ROUND_HALF_UP))


@dataclasses.dataclass
class RowResult:
    status: str               # ok | ok_unverified | flagged | rejected
    diff_pct: Decimal | None
    diff_json: dict | None
    normalized: dict


def recompute_row(session, tenant_id, n: dict) -> RowResult:
    try:
        req = to_quote_request(n)
        inp = build_inputs(session, tenant_id, req)
        cfg = tenant_repo.get_cost_config(session, tenant_id, req.deal_date)
        result = compute_landed(inp)

        recorded = n.get("actual_landed_cost_major")
        if not recorded:
            return RowResult("ok_unverified", None,
                             {"note": "no recorded landed cost; usable for training, never golden"}, n)

        base = cfg.base_currency
        rec_ccy = n.get("recorded_currency", base)
        recorded_minor = to_base_minor(recorded, rec_ccy, base, inp.locked_rates)
        scope = set(cfg.landed_scope)
        computed_scoped = sum(l.amount.amount_minor for l in result.lines if l.type in scope)
        pct = (Decimal(abs(recorded_minor - computed_scoped)) / Decimal(recorded_minor)
               if recorded_minor else Decimal("0"))

        recorded_lines = {
            k.replace("recorded_", "").replace("_major", ""): to_base_minor(n[k], rec_ccy, base, inp.locked_rates)
            for k in ("recorded_freight_major", "recorded_duty_major") if n.get(k) is not None
        }
        diff_json = {
            "scope": sorted(scope), "recorded_minor": recorded_minor,
            "computed_scoped_minor": computed_scoped, "recorded_currency": rec_ccy,
            "lines": [{"type": l.type, "amount_minor": l.amount.amount_minor, "in_scope": l.type in scope,
                       "recorded_minor": recorded_lines.get(l.type)} for l in result.lines],
        }
        return RowResult("flagged" if pct > DIVERGENCE_THRESHOLD else "ok", pct, diff_json, n)
    except Exception as e:
        return RowResult("rejected", None, {"error": str(e)}, n)


def _json(o) -> str:
    return json.dumps(o, default=str)


def insert_deal(session, tenant_id, batch_id: str, user_id, n: dict, product, is_golden: bool) -> str:
    req = to_quote_request(n)
    cfg = tenant_repo.get_cost_config(session, tenant_id, req.deal_date)
    base = cfg.base_currency
    inp = build_inputs(session, tenant_id, req)
    result = compute_landed(inp)

    origin = n.get("origin_country") or product.attributes.get("origin_country")
    if not origin:
        raise ValueError(f"cannot resolve origin_country for {product.sku}")
    dest = n.get("dest_country") or cfg.dest_country

    rec_ccy = n.get("recorded_currency", base)
    deal_id = str(uuid.uuid4())
    session.execute(text("""
      INSERT INTO deals
        (id, tenant_id, deal_ref, product_id, quantity, base_unit, incoterm, origin_country,
         dest_country, deal_date, currency, base_currency, locked_rates, inputs_snapshot,
         actual_landed_cost_minor, actual_sell_price_minor, status, created_by, is_golden)
      VALUES
        (:id, :t, :ref, :pid, :qty, :unit, :inc, :orig, :dest, :dd, :ccy, :bccy,
         CAST(:lr AS jsonb), CAST(:snap AS jsonb), :landed, :sell, 'confirmed', :u, :golden)
    """), {
        "id": deal_id, "t": tenant_id, "ref": f"IMP-{str(batch_id)[:8]}-{n['_row_index']}",
        "pid": product.id, "qty": n["quantity"], "unit": req.base_unit, "inc": req.incoterm,
        "orig": origin, "dest": dest, "dd": req.deal_date, "ccy": req.currency, "bccy": base,
        "lr": _json({k: str(v) for k, v in inp.locked_rates.items()}),
        "snap": _json(serialize.to_json(inp)),
        "landed": to_base_minor(n.get("actual_landed_cost_major"), rec_ccy, base, inp.locked_rates),
        "sell": to_base_minor(n.get("actual_sell_price_major"), rec_ccy, base, inp.locked_rates),
        "u": user_id, "golden": is_golden,
    })

    for order, line in enumerate(result.lines):
        session.execute(text("""
          INSERT INTO deal_cost_lines (tenant_id, deal_id, cost_type, amount_minor, currency, source, note, line_order)
          VALUES (:t, :d, :ct, :am, :ccy, :src, :n, :o)
        """), {"t": tenant_id, "d": deal_id, "ct": line.type, "am": line.amount.amount_minor,
               "ccy": line.amount.currency, "src": line.source, "n": line.note, "o": order})

    for order, key in enumerate(("recorded_freight_major", "recorded_duty_major"), start=900):
        if n.get(key) is None:
            continue
        session.execute(text("""
          INSERT INTO deal_cost_lines (tenant_id, deal_id, cost_type, amount_minor, currency, source, note, line_order)
          VALUES (:t, :d, :ct, :am, :ccy, 'manual', 'from import file', :o)
        """), {"t": tenant_id, "d": deal_id, "ct": key.replace("recorded_", "").replace("_major", ""),
               "am": to_base_minor(n[key], rec_ccy, base, inp.locked_rates), "ccy": base, "o": order})
    return deal_id


def persist_confirmed(session, tenant_id, batch_id: str, user_id) -> dict:
    """Persists ok / ok_unverified rows and flagged rows the user accepted.
    Golden: explicit approval, status ok, diff <= 1%, seafood, recorded cost present."""
    rows = session.execute(text("""
      SELECT id, row_index, normalized, status, diff_pct, accepted, is_golden_approved
        FROM import_rows
       WHERE tenant_id = :t AND batch_id = :b AND deal_id IS NULL
         AND (status IN ('ok', 'ok_unverified') OR (status = 'flagged' AND accepted = true))
       ORDER BY row_index
    """), {"t": tenant_id, "b": batch_id}).mappings().all()

    inserted = golden = 0
    for r in rows:
        n = dict(r["normalized"])
        product = product_repo.get_product(session, tenant_id, n["sku"])
        eligible = (r["status"] == "ok" and r["is_golden_approved"] and r["diff_pct"] is not None
                    and Decimal(str(r["diff_pct"])) <= DIVERGENCE_THRESHOLD
                    and product.category == "seafood" and n.get("actual_landed_cost_major") is not None)
        deal_id = insert_deal(session, tenant_id, batch_id, user_id, n, product, eligible)
        session.execute(text("UPDATE import_rows SET deal_id = :d WHERE id = :i"), {"d": deal_id, "i": r["id"]})
        inserted += 1
        golden += int(eligible)

    session.execute(text("""
      UPDATE import_batches SET status = 'confirmed', confirmed_at = now()
       WHERE tenant_id = :t AND id = :b
    """), {"t": tenant_id, "b": batch_id})
    return {"inserted": inserted, "golden_created": golden}
