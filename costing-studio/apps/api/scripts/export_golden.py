"""Export golden deals as pure-engine fixtures (reads deals.inputs_snapshot)."""
from __future__ import annotations
import json
import os
from pathlib import Path

from sqlalchemy import text

from _db import MigratorSessionLocal
from costing.engine import compute_landed
from costing.serialize import from_json, to_json

OUT_DIR = Path(os.environ.get("GOLDEN_DIR", "/app/packages/costing/tests/golden"))


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with MigratorSessionLocal() as s:
        rows = s.execute(text("""
          SELECT deal_ref, inputs_snapshot FROM deals
           WHERE is_golden = true AND inputs_snapshot IS NOT NULL ORDER BY deal_ref
        """)).mappings().all()
    for r in rows:
        inp = from_json(r["inputs_snapshot"])
        result = compute_landed(inp)
        fixture = {
            "deal_ref": r["deal_ref"],
            "inputs": to_json(inp),
            "expected": {
                "landed_cost": {"amount_minor": result.landed_cost.amount_minor,
                                "currency": result.landed_cost.currency},
                "lines": [{"type": l.type, "amount_minor": l.amount.amount_minor} for l in result.lines],
            },
        }
        (OUT_DIR / f"{r['deal_ref']}.json").write_text(json.dumps(fixture, indent=2, ensure_ascii=False))
    print(f"wrote {len(rows)} golden fixtures to {OUT_DIR}")


if __name__ == "__main__":
    main()
