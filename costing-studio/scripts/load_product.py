"""Load one product from a JSON file through the same service layer the API uses, then print its envelope.

    DATABASE_URL=postgresql+psycopg://costing_app:app_pw@localhost:5432/costing \\
      uv run python scripts/load_product.py sample_data/example_product.json

JSON:
  {"name": "...", "category": "...", "base_unit": "bag", "attributes": {...},
   "cost_elements": [{"name": "clinker", "unit": "tonne", "rate": "28.000", "currency": "OMR",
                      "qty_per_unit": "0.0475", "valid_from": "2024-01-01"}, ...],
   "margin": {"min_pct": "0.15", "target_pct": "0.30", "max_pct": "0.45", "valid_from": "2024-01-01"}}

qty_per_unit, max_pct and valid_from are optional (defaults: 1, mirrored ceiling, today).
Everything is written in one transaction as costing_app with the tenant set (RLS applies, audit_log
records it); any error rolls the whole product back.

Re-running on an existing product (same name) is idempotent:
  - attributes: replaced by the file's when they differ (keys added, removed or modified); else untouched;
  - cost elements / margin: a new dated version is posted only when the file differs from the current
    version (rate, currency, unit, qty_per_unit / min, target, max); identical ones are skipped. A version
    starting the same day as the current one replaces it in place while no pricing snapshot exists since
    that day ("updated version for ..."); after a snapshot it is refused ("... already exists").
    Elements stored but absent from the file are left as they are. category and base_unit are not changed.
The envelope printed at the end is a preview and is never saved as a pricing snapshot.
--dry-run prints that plan and exits without writing anything.
"""
from __future__ import annotations
import argparse
import json
import sys
from decimal import Decimal
from pathlib import Path

from _loader import DEFAULT_TENANT, LoadError, check_exact, print_envelope, run_in_tenant

from pydantic import ValidationError
from sqlalchemy import text


def _parse(spec: dict):
    from costing_api.schemas import CostElementIn, MarginConfigIn, ProductIn
    try:
        p = ProductIn(**{k: spec[k] for k in ("name", "category", "base_unit") if k in spec},
                      attributes=spec.get("attributes") or {})
        elements = [CostElementIn(**e) for e in spec.get("cost_elements") or []]
        margin = MarginConfigIn(**spec["margin"]) if spec.get("margin") else None
    except (ValidationError, TypeError) as e:
        raise LoadError(f"invalid product file: {e}") from None
    if not elements:
        raise LoadError("cost_elements is empty")
    if margin is None:
        raise LoadError("margin is required")
    for e in elements:
        check_exact(e.rate, e.currency.upper(), f"cost element {e.name!r} rate")
    return p, elements, margin


def _dec(v):
    return None if v is None else Decimal(str(v))


def _pcts(ms) -> str:
    return "/".join("-" if m is None else f"{(m * 100).normalize():f}%" for m in ms)


def plan(session, tenant: dict, spec: dict) -> dict:
    """What load() would do, without writing: {"product_id", "create", "attributes": {added, removed,
    modified}, "elements": [(name, reason)], "margin": reason or None}."""
    from costing.currencies import exponent_of
    from costing.money import Money
    p, elements, margin = _parse(spec)
    t = tenant["tenant_id"]
    row = session.execute(text("SELECT id, attributes FROM products WHERE tenant_id = :t AND name = :n"),
                          {"t": t, "n": p.name}).mappings().first()
    if row is None:
        return {"product_id": None, "create": True, "attributes": {"added": dict(p.attributes), "removed": {},
                                                                    "modified": {}},
                "elements": [(e.name, "new") for e in elements], "margin": "new"}
    old, new = row["attributes"] or {}, dict(p.attributes)
    attrs = {"added": {k: new[k] for k in new.keys() - old.keys()},
             "removed": {k: old[k] for k in old.keys() - new.keys()},
             "modified": {k: (old[k], new[k]) for k in old.keys() & new.keys() if old[k] != new[k]}}
    current = {r["name"]: r for r in session.execute(text("""
      SELECT ce.name, ce.unit, ce.rate_minor, ce.currency, b.qty_per_unit
        FROM cost_elements ce LEFT JOIN product_bom b ON b.cost_element_id = ce.id
       WHERE ce.tenant_id = :t AND ce.product_id = :p AND ce.valid_to IS NULL
    """), {"t": t, "p": str(row["id"])}).mappings()}
    changed = []
    for e in elements:
        cur = current.get(e.name)
        if cur is None:
            changed.append((e.name, "new"))
            continue
        diffs = []
        rate_minor = Money.from_major(e.rate, e.currency.upper()).amount_minor
        if (rate_minor, e.currency.upper()) != (cur["rate_minor"], cur["currency"]):
            exp = exponent_of(cur["currency"])
            diffs.append(f"rate {Money(cur['rate_minor'], cur['currency']).major:.{exp}f} {cur['currency']} -> "
                         f"{e.rate} {e.currency.upper()}")
        if e.unit != cur["unit"]:
            diffs.append(f"unit {cur['unit']} -> {e.unit}")
        if e.qty_per_unit is not None and _dec(e.qty_per_unit) != _dec(cur["qty_per_unit"]):
            diffs.append(f"qty_per_unit {cur['qty_per_unit']} -> {e.qty_per_unit}")
        if diffs:
            changed.append((e.name, "; ".join(diffs)))
    m = session.execute(text("""
      SELECT min_pct, target_pct, max_pct FROM margin_config
       WHERE tenant_id = :t AND product_id = :p AND valid_to IS NULL
    """), {"t": t, "p": str(row["id"])}).mappings().first()
    want = (_dec(margin.min_pct), _dec(margin.target_pct), _dec(margin.max_pct))
    have = (_dec(m["min_pct"]), _dec(m["target_pct"]), _dec(m["max_pct"])) if m else None
    margin_change = None if want == have else (
        "new" if have is None else f"min/target/max {_pcts(have)} -> {_pcts(want)}")
    return {"product_id": str(row["id"]), "create": False, "attributes": attrs, "elements": changed,
            "margin": margin_change}


def has_changes(pl: dict) -> bool:
    return pl["create"] or any(pl["attributes"].values()) or bool(pl["elements"]) or pl["margin"] is not None


def describe(pl: dict, name: str) -> str:
    out = [f"{'create' if pl['create'] else 'existing'} product {name!r}"]
    a = pl["attributes"]
    if not pl["create"]:
        out += [f"  attribute added:    {k} = {v!r}" for k, v in sorted(a["added"].items())]
        out += [f"  attribute removed:  {k} (was {v!r})" for k, v in sorted(a["removed"].items())]
        out += [f"  attribute modified: {k}: {o!r} -> {n!r}" for k, (o, n) in sorted(a["modified"].items())]
        if not any(a.values()):
            out.append("  attributes: unchanged")
    out += [f"  cost element versioned: {n} ({why})" for n, why in pl["elements"]] or ["  cost elements: unchanged"]
    out.append(f"  margin versioned: {pl['margin']}" if pl["margin"] else "  margin: unchanged")
    return "\n".join(out)


def load(session, tenant: dict, spec: dict) -> str:
    """Create the product, or bring an existing one in line with the file (see module doc)."""
    from costing_api.services import product_service
    p, elements, margin = _parse(spec)
    pl = plan(session, tenant, spec)
    if pl["create"]:
        pid = str(product_service.create_product(session, tenant, p.name, p.category, p.base_unit,
                                                 p.attributes)["id"])
    else:
        pid = pl["product_id"]
        if any(pl["attributes"].values()):
            product_service.update_product(session, tenant, pid, {"attributes": dict(p.attributes)})
    versioned = {n for n, _ in pl["elements"]}
    for e in elements:
        if e.name in versioned:
            out = product_service.add_cost_element(session, tenant, pid, name=e.name, unit=e.unit, rate=e.rate,
                                                   currency=e.currency.upper(), valid_from=e.valid_from,
                                                   qty_per_unit=e.qty_per_unit)
            if out.get("updated_in_place"):
                print(f"updated version for {e.name}")
    if pl["margin"] is not None:
        out = product_service.set_margin_config(session, tenant, pid, margin.min_pct, margin.target_pct,
                                                margin.max_pct, margin.valid_from)
        if out.get("updated_in_place"):
            print("updated version for margin")
    return pid


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("file", type=Path)
    ap.add_argument("--tenant", default=DEFAULT_TENANT, help="tenant id (default: the seeded example tenant)")
    ap.add_argument("--dry-run", action="store_true", help="print what would change and exit without writing")
    args = ap.parse_args(argv)
    try:
        spec = json.loads(args.file.read_text())
    except (OSError, json.JSONDecodeError) as e:
        sys.exit(f"error: cannot read {args.file}: {e}")
    pl = run_in_tenant(args.tenant, lambda s, t: plan(s, t, spec))
    if args.dry_run:
        print("dry run, nothing written:\n" + describe(pl, spec["name"]))
        return 0
    if not has_changes(pl):
        print(f"product {spec['name']!r} id={pl['product_id']} unchanged")
        return 0
    pid = run_in_tenant(args.tenant, lambda s, t: load(s, t, spec))
    print(f"{'loaded' if pl['create'] else 'updated'} product {spec['name']!r} id={pid}\n" + describe(pl, spec["name"]))
    run_in_tenant(args.tenant, lambda s, t: print_envelope(s, t, pid, "load_product", save=False))
    return 0



if __name__ == "__main__":
    sys.exit(main())
