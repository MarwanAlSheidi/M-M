\set ON_ERROR_STOP on
-- Run after `alembic upgrade head`, as superuser.

-- Tenant-scoped tables: DML allowed, RLS filters rows.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenants, users, api_keys, products, parties, deals, deal_cost_lines, deal_inputs,
  predictions, quote_anomalies, market_prices, audit_log, tenant_cost_config,
  product_cost_config, tenant_lane_costs, model_registry, market_price_stats,
  import_batches, import_rows, import_column_map, job_runs
TO costing_app;

-- Reference tables: SELECT only for the app.
GRANT SELECT ON hs_duty_rates, lane_costs, hijri_calendar, fx_rates, market_sources TO costing_app;
REVOKE INSERT, UPDATE, DELETE ON hs_duty_rates, lane_costs, hijri_calendar, fx_rates, market_sources
  FROM costing_app;

-- Worker: global FX writes only.
GRANT SELECT, INSERT ON fx_rates TO costing_worker;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO costing_app, costing_worker;
