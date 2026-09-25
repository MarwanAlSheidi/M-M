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
records it); any error rolls the whole product back. An existing product name is refused.
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

from _loader import DEFAULT_TENANT, LoadError, check_exact, print_envelope, run_in_tenant

from pydantic import ValidationError


def load(session, tenant: dict, spec: dict) -> str:
    from costing_api.schemas import CostElementIn, MarginConfigIn, ProductIn
    from costing_api.services import product_service

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

    product = product_service.create_product(session, tenant, p.name, p.category, p.base_unit, p.attributes)
    for e in elements:
        product_service.add_cost_element(session, tenant, product["id"], name=e.name, unit=e.unit, rate=e.rate,
                                         currency=e.currency.upper(), valid_from=e.valid_from,
                                         qty_per_unit=e.qty_per_unit)
    product_service.set_margin_config(session, tenant, product["id"], margin.min_pct, margin.target_pct,
                                      margin.max_pct, margin.valid_from)
    return str(product["id"])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("file", type=Path)
    ap.add_argument("--tenant", default=DEFAULT_TENANT, help="tenant id (default: the seeded example tenant)")
    args = ap.parse_args(argv)
    try:
        spec = json.loads(args.file.read_text())
    except (OSError, json.JSONDecodeError) as e:
        sys.exit(f"error: cannot read {args.file}: {e}")
    pid = run_in_tenant(args.tenant, lambda s, t: load(s, t, spec))
    print(f"loaded product {spec['name']!r} id={pid}")
    run_in_tenant(args.tenant, lambda s, t: print_envelope(s, t, pid, "load_product"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
