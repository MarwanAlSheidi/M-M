"""Seed one Oman tuna tenant (dev). Idempotent. Runs as costing_migrator."""
from __future__ import annotations
from datetime import date, timedelta

from sqlalchemy import text

from _db import MigratorSessionLocal

TENANT_ID = "11111111-1111-1111-1111-111111111111"
USER_ID = "22222222-2222-2222-2222-222222222222"
PRODUCT_ID = "33333333-3333-3333-3333-333333333333"


def main() -> None:
    with MigratorSessionLocal() as s, s.begin():
        s.execute(text("""
          INSERT INTO tenants (id, name, base_currency, locale)
          VALUES (:id, 'Oman Tuna Co', 'OMR', 'en') ON CONFLICT (id) DO NOTHING
        """), {"id": TENANT_ID})
        s.execute(text("""
          INSERT INTO users (id, tenant_id, email, role, locale_pref)
          VALUES (:id, :t, 'ops@example.om', 'admin', 'en') ON CONFLICT DO NOTHING
        """), {"id": USER_ID, "t": TENANT_ID})
        s.execute(text("""
          INSERT INTO tenant_cost_config (tenant_id, valid_from, base_currency, dest_country, vat_rate,
            vat_recoverable, insurance_rate, wacc, overhead_pct, customer_days, supplier_terms_days, default_storage_days)
          VALUES (:t, DATE '2020-01-01', 'OMR', 'OM', 0.05, true, 0.004, 0.08, 0.03, 45, 30, 15)
          ON CONFLICT (tenant_id, valid_from) DO NOTHING
        """), {"t": TENANT_ID})
        s.execute(text("""
          INSERT INTO products (id, tenant_id, sku, name_en, name_ar, category, base_unit, hs_code,
                                attributes, market_key)
          VALUES (:id, :t, 'TUNA-YF-WR', 'Yellowfin whole round', 'تونة صفراء كاملة', 'seafood', 'kg',
                  '0303.42', '{"species":"YF","form":"WR","grade":"A","origin_country":"TH"}'::jsonb,
                  'YF-WR-TH')
          ON CONFLICT DO NOTHING
        """), {"id": PRODUCT_ID, "t": TENANT_ID})
        s.execute(text("""
          INSERT INTO product_cost_config (tenant_id, product_id, valid_from, default_yield,
            processing_rate_minor, storage_rate_minor_per_unit_day, rate_currency, default_mode)
          VALUES (:t, :p, DATE '2020-01-01', 0.55, 80, 3, 'OMR', 'sea')
          ON CONFLICT DO NOTHING
        """), {"t": TENANT_ID, "p": PRODUCT_ID})
        # UNVERIFIED placeholder - must be replaced with a verified Oman Customs Tariff row before prod.
        s.execute(text("""
          INSERT INTO hs_duty_rates (hs_code, import_country, origin_country, rate, valid_from, source,
                                     source_date, verified)
          VALUES ('0303.42', 'OM', NULL, 0.0500, DATE '2024-01-01',
                  'UNVERIFIED - placeholder; replace with Oman Customs Tariff row', DATE '2024-01-01', false)
          ON CONFLICT DO NOTHING
        """))
        s.execute(text("""
          INSERT INTO lane_costs (origin_country, dest_country, mode, clearing_fixed_minor, clearing_currency,
                                  valid_from, source)
          VALUES ('TH', 'OM', 'sea', 250000, 'OMR', DATE '2024-01-01', 'placeholder')
          ON CONFLICT ON CONSTRAINT uq_lane_key DO NOTHING
        """))
        # 90 days of flat dev prices -> retrain must skip (needs 180).
        s.execute(text("""
          INSERT INTO market_prices (tenant_id, market_key, source, price_major, currency, unit, observed_at)
          VALUES (:t, 'YF-WR-TH', 'seed', 3.20, 'USD', 'kg', :d)
          ON CONFLICT ON CONSTRAINT uq_market_prices_obs DO NOTHING
        """), [{"t": TENANT_ID, "d": date.today() - timedelta(days=i)} for i in range(90)])
        s.execute(text("""
          INSERT INTO market_price_stats (tenant_id, market_key, window_days, p2_5, p50, p97_5)
          VALUES (:t, 'YF-WR-TH', 365, 2.80, 3.20, 3.90)
          ON CONFLICT (tenant_id, market_key, window_days) DO UPDATE
            SET p2_5 = EXCLUDED.p2_5, p50 = EXCLUDED.p50, p97_5 = EXCLUDED.p97_5, computed_at = now()
        """), {"t": TENANT_ID})
    print("Seed complete. tenant_id =", TENANT_ID)


if __name__ == "__main__":
    main()
