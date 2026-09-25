"""Seed one example tenant (dev): a 50 kg cement bag, priced in OMR. Idempotent; runs as
costing_migrator. Everything product-specific is rows: one product, six cost elements (with BOM
quantities), one margin config and two manual market sources. No code knows about cement.

Envelope on these rows (margin on price, 15 / 30 / 45 %):
  unit cost 1.868 · floor 2.198 · target 2.669 · ceiling 3.396 OMR per bag
"""
from __future__ import annotations
import os

import bcrypt
from sqlalchemy import text

from _db import MigratorSessionLocal

TENANT_ID = "11111111-1111-1111-1111-111111111111"
USER_ID = "22222222-2222-2222-2222-222222222222"
PRODUCT_ID = "33333333-3333-3333-3333-333333333333"
VALID_FROM = "2024-01-01"

# name, unit, rate_minor, currency, qty_per_unit (None = priced per bag)
COST_ELEMENTS = [
    ("clinker", "tonne", 28000, "OMR", "0.0475"),      # 28.000 OMR/t x 47.5 kg
    ("gypsum", "tonne", 18000, "OMR", "0.0025"),       # 18.000 OMR/t x 2.5 kg
    ("grinding energy", "kWh", 25, "OMR", "5.5"),      # 0.025 OMR/kWh x 5.5 kWh
    ("paper bag", "each", 90, "OMR", None),
    ("labour & overhead", "bag", 150, "OMR", None),
    ("freight to depot", "bag", 30, "USD", None),      # 0.30 USD -> 0.115 OMR at the peg
]


def main() -> None:
    with MigratorSessionLocal() as s, s.begin():
        s.execute(text("""
          INSERT INTO tenants (id, name, base_currency, locale)
          VALUES (:id, 'Example Building Supplies', 'OMR', 'en') ON CONFLICT (id) DO NOTHING
        """), {"id": TENANT_ID})
        s.execute(text("""
          INSERT INTO users (id, tenant_id, email, role, locale_pref)
          VALUES (:id, :t, 'ops@example.om', 'admin', 'en') ON CONFLICT DO NOTHING
        """), {"id": USER_ID, "t": TENANT_ID})
        # Dev login (POST /api/v1/auth/login). Only sets a password if none exists yet.
        s.execute(text("UPDATE users SET password_hash = :h WHERE id = :id AND password_hash IS NULL"),
                  {"id": USER_ID, "h": bcrypt.hashpw(os.environ.get("SEED_ADMIN_PASSWORD", "dev-password").encode(),
                                                     bcrypt.gensalt()).decode()})

        s.execute(text("""
          INSERT INTO products (id, tenant_id, name, category, base_unit, attributes)
          VALUES (:id, :t, 'Portland cement 50kg bag', 'building_materials', 'bag',
                  '{"grade": "OPC 42.5", "bag_kg": 50}'::jsonb)
          ON CONFLICT DO NOTHING
        """), {"id": PRODUCT_ID, "t": TENANT_ID})

        for name, unit, rate_minor, ccy, qty in COST_ELEMENTS:
            ce_id = s.execute(text("""
              INSERT INTO cost_elements (tenant_id, product_id, name, unit, rate_minor, currency, valid_from)
              SELECT :t, :p, :n, :u, :r, :c, CAST(:vf AS date)
               WHERE NOT EXISTS (SELECT 1 FROM cost_elements WHERE tenant_id = :t AND product_id = :p AND name = :n)
              RETURNING id
            """), {"t": TENANT_ID, "p": PRODUCT_ID, "n": name, "u": unit, "r": rate_minor, "c": ccy,
                   "vf": VALID_FROM}).scalar()
            if ce_id and qty is not None:
                s.execute(text("""
                  INSERT INTO product_bom (tenant_id, product_id, cost_element_id, qty_per_unit)
                  VALUES (:t, :p, :c, :q)
                """), {"t": TENANT_ID, "p": PRODUCT_ID, "c": ce_id, "q": qty})

        s.execute(text("""
          INSERT INTO margin_config (tenant_id, product_id, min_pct, target_pct, max_pct, valid_from)
          SELECT :t, :p, 0.15, 0.30, 0.45, CAST(:vf AS date)
           WHERE NOT EXISTS (SELECT 1 FROM margin_config WHERE tenant_id = :t AND product_id = :p)
        """), {"t": TENANT_ID, "p": PRODUCT_ID, "vf": VALID_FROM})

        # Manual sources (no parser): prices arrive by CSV / API ingest.
        for source, freq, stale in (("retail-survey", "weekly", 14), ("distributor-list", "monthly", 45)):
            s.execute(text("""
              INSERT INTO market_sources (tenant_id, product_id, source, frequency, staleness_days)
              VALUES (:t, :p, :s, :f, :d) ON CONFLICT ON CONSTRAINT uq_market_sources DO NOTHING
            """), {"t": TENANT_ID, "p": PRODUCT_ID, "s": source, "f": freq, "d": stale})
    print("Seed complete. tenant_id =", TENANT_ID, "product_id =", PRODUCT_ID)


if __name__ == "__main__":
    main()
