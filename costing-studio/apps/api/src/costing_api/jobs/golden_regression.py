"""Nightly: engine drift (recompute vs stored formula lines) and scoped total vs recorded actual."""
from __future__ import annotations
from decimal import Decimal

from sqlalchemy import text

from costing.engine import compute_landed
from costing.serialize import from_json

from ..repos import tenant_repo

THRESHOLD = Decimal("0.01")


def run(session, tenant_id=None):
    if not tenant_id:
        return {"skipped": True, "reason": "requires tenant_id"}
    deals = session.execute(text("""
      SELECT id, deal_ref, inputs_snapshot, actual_landed_cost_minor
        FROM deals WHERE is_golden = true AND tenant_id = :t AND inputs_snapshot IS NOT NULL
    """), {"t": tenant_id}).mappings().all()
    if not deals:
        return {"skipped": True, "reason": "no golden deals"}

    line_drift, total_drift = [], []
    for d in deals:
        inp = from_json(d["inputs_snapshot"])
        result = compute_landed(inp)
        stored = dict(session.execute(text("""
          SELECT cost_type, amount_minor FROM deal_cost_lines
           WHERE deal_id = :id AND source <> 'manual'
        """), {"id": d["id"]}).all())
        for line in result.lines:
            got = stored.get(line.type)
            if got is not None and got != line.amount.amount_minor:
                line_drift.append({"deal": d["deal_ref"], "line": line.type, "stored": got,
                                   "recomputed": line.amount.amount_minor})
        cfg = tenant_repo.get_cost_config(session, tenant_id, inp.deal_date)
        scope = set(cfg.landed_scope)
        scoped = sum(l.amount.amount_minor for l in result.lines if l.type in scope)
        recorded = d["actual_landed_cost_minor"]
        if recorded:
            pct = Decimal(abs(scoped - recorded)) / Decimal(recorded)
            if pct > THRESHOLD:
                total_drift.append({"deal": d["deal_ref"], "recorded": recorded, "scoped": scoped, "pct": str(pct)})

    if line_drift or total_drift:
        raise RuntimeError(f"golden drift: lines={line_drift[:3]} totals={total_drift[:3]}")
    return {"rows": len(deals)}
