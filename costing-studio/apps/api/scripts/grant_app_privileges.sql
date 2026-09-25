\set ON_ERROR_STOP on
-- Run after `alembic upgrade head`, as superuser.

-- Tenant-scoped tables: DML allowed, RLS filters rows.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenants, users, api_keys, parties, products, cost_elements, product_bom, margin_config,
  market_sources, market_prices, pricing_snapshots, audit_log, model_registry,
  import_batches, import_rows, import_column_map, job_runs
TO costing_app;

-- Reference tables: SELECT only for the app.
GRANT SELECT ON hijri_calendar, fx_rates TO costing_app;
REVOKE INSERT, UPDATE, DELETE ON hijri_calendar, fx_rates FROM costing_app;

-- Worker: global FX writes only.
GRANT SELECT, INSERT ON fx_rates TO costing_worker;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO costing_app, costing_worker;
