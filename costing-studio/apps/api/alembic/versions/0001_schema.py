"""Full schema (consolidated final state of the design rounds).

Revision ID: 0001
Revises:
"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = r"""
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  base_currency varchar(3) NOT NULL,
  locale varchar(5) NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL,
  role text NOT NULL,
  password_hash text,
  locale_pref varchar(5) NOT NULL DEFAULT 'en'
);
CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email));

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  key_hash text NOT NULL UNIQUE,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  sku text NOT NULL,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  category text NOT NULL,
  base_unit varchar(10) NOT NULL,
  hs_code text NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  market_key text NOT NULL,
  UNIQUE (tenant_id, sku)
);

CREATE TABLE parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  type text NOT NULL,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  country varchar(2) NOT NULL,
  currency varchar(3) NOT NULL,
  terms_days integer NOT NULL DEFAULT 0
);

CREATE TABLE deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  deal_ref text NOT NULL,
  product_id uuid NOT NULL REFERENCES products(id),
  supplier_id uuid REFERENCES parties(id),
  buyer_id uuid REFERENCES parties(id),
  quantity numeric(20,6) NOT NULL,
  base_unit varchar(10) NOT NULL,
  incoterm varchar(4) NOT NULL,
  origin_country varchar(2) NOT NULL,
  dest_country varchar(2) NOT NULL,
  deal_date date NOT NULL,
  currency varchar(3) NOT NULL,
  base_currency varchar(3) NOT NULL,
  locked_rates jsonb NOT NULL DEFAULT '{}'::jsonb,
  inputs_snapshot jsonb,
  actual_landed_cost_minor bigint,
  actual_sell_price_minor bigint,
  status text NOT NULL DEFAULT 'draft',
  is_golden boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_deals_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT uq_deals_ref UNIQUE (tenant_id, deal_ref)
);

CREATE TABLE deal_cost_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  deal_id uuid NOT NULL,
  cost_type text NOT NULL,
  amount_minor bigint NOT NULL,
  currency varchar(3) NOT NULL,
  source text NOT NULL DEFAULT 'formula',
  note text,
  line_order integer NOT NULL DEFAULT 0,
  FOREIGN KEY (deal_id, tenant_id) REFERENCES deals(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX ix_dcl_deal ON deal_cost_lines (tenant_id, deal_id);

CREATE TABLE deal_inputs (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  deal_id uuid NOT NULL,
  feature_name text NOT NULL,
  value_num numeric(24,10),
  value_text text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (deal_id, tenant_id) REFERENCES deals(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE predictions (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  deal_id uuid,
  model_name text NOT NULL,
  model_version text NOT NULL,
  target text NOT NULL,
  value_minor bigint NOT NULL,
  p10_minor bigint,
  p90_minor bigint,
  shap jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (deal_id, tenant_id) REFERENCES deals(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE quote_anomalies (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  supplier_id uuid REFERENCES parties(id),
  product_id uuid REFERENCES products(id),
  quote_minor bigint NOT NULL,
  currency varchar(3) NOT NULL,
  score numeric(8,4) NOT NULL,
  reason text NOT NULL,
  flagged_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE market_prices (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  market_key text NOT NULL,
  source text NOT NULL,
  price_major numeric(20,8) NOT NULL CHECK (price_major > 0),
  currency varchar(3) NOT NULL,
  unit varchar(10) NOT NULL,
  observed_at date NOT NULL,
  CONSTRAINT uq_market_prices_obs UNIQUE (tenant_id, market_key, source, observed_at)
);

-- Global reference data. Direction contract: 1 base = rate x quote.
CREATE TABLE fx_rates (
  id bigserial PRIMARY KEY,
  base varchar(3) NOT NULL,
  quote varchar(3) NOT NULL,
  rate numeric(24,10) NOT NULL CHECK (rate > 0),
  source text NOT NULL,
  observed_at date NOT NULL,
  CONSTRAINT uq_fx_obs UNIQUE (base, quote, observed_at, source)
);
COMMENT ON TABLE fx_rates IS 'Direction: 1 base = rate * quote. Pegged GCC currencies are never stored.';

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid,
  entity text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  diff jsonb,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_cost_config (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  valid_from date NOT NULL,
  valid_to date,
  base_currency varchar(3) NOT NULL,
  dest_country varchar(2) NOT NULL,
  vat_rate numeric(6,4) NOT NULL DEFAULT 0.05,
  vat_recoverable boolean NOT NULL DEFAULT true,
  wacc numeric(6,4) NOT NULL DEFAULT 0.08,
  overhead_pct numeric(6,4) NOT NULL DEFAULT 0,
  customer_days integer NOT NULL DEFAULT 0,
  supplier_terms_days integer NOT NULL DEFAULT 0,
  default_storage_days integer NOT NULL DEFAULT 0,
  landed_scope jsonb NOT NULL DEFAULT
    '["purchase","freight","insurance","duty","clearing","processing","storage"]'::jsonb,
  PRIMARY KEY (tenant_id, valid_from),
  CONSTRAINT ex_tcc_period EXCLUDE USING gist (
    tenant_id WITH =, daterange(valid_from, COALESCE(valid_to, 'infinity'::date)) WITH &&)
);

CREATE TABLE product_cost_config (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_id uuid NOT NULL REFERENCES products(id),
  valid_from date NOT NULL,
  valid_to date,
  default_yield numeric(6,4) NOT NULL,
  processing_rate_minor bigint NOT NULL DEFAULT 0,
  storage_rate_minor_per_unit_day bigint NOT NULL DEFAULT 0,
  rate_currency varchar(3) NOT NULL,
  default_mode text NOT NULL DEFAULT 'sea',
  kg_per_case numeric(20,6),
  PRIMARY KEY (tenant_id, product_id, valid_from),
  CONSTRAINT ex_pcc_period EXCLUDE USING gist (
    tenant_id WITH =, product_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date)) WITH &&)
);

CREATE TABLE hs_duty_rates (
  id bigserial PRIMARY KEY,
  hs_code text NOT NULL,
  import_country varchar(2) NOT NULL,
  origin_country varchar(2),
  rate numeric(6,4) NOT NULL,
  valid_from date NOT NULL,
  valid_to date,
  source text NOT NULL,
  source_date date NOT NULL,
  verified boolean NOT NULL DEFAULT false
);
-- NULLS NOT DISTINCT so the NULL-origin default row is unique too (PG15+).
CREATE UNIQUE INDEX uq_duty_key ON hs_duty_rates (hs_code, import_country, origin_country, valid_from)
  NULLS NOT DISTINCT;

CREATE TABLE lane_costs (
  id bigserial PRIMARY KEY,
  origin_country varchar(2) NOT NULL,
  dest_country varchar(2) NOT NULL,
  mode text NOT NULL,
  clearing_fixed_minor bigint NOT NULL DEFAULT 0,
  clearing_currency varchar(3) NOT NULL,
  valid_from date NOT NULL,
  valid_to date,
  source text NOT NULL,
  CONSTRAINT uq_lane_key UNIQUE (origin_country, dest_country, mode, valid_from)
);

CREATE TABLE tenant_lane_costs (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  origin_country varchar(2) NOT NULL,
  dest_country varchar(2) NOT NULL,
  mode text NOT NULL,
  clearing_fixed_minor bigint NOT NULL DEFAULT 0,
  clearing_currency varchar(3) NOT NULL,
  valid_from date NOT NULL,
  valid_to date,
  source text NOT NULL,
  CONSTRAINT uq_tlc_key UNIQUE (tenant_id, origin_country, dest_country, mode, valid_from)
);

CREATE TABLE model_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  target text NOT NULL,
  version text NOT NULL,
  artifact_path text NOT NULL,
  target_currency varchar(3) NOT NULL,
  target_unit varchar(10) NOT NULL,
  library_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_champion boolean NOT NULL DEFAULT false,
  promoted_at timestamptz,
  UNIQUE (tenant_id, target, version)
);

CREATE TABLE market_price_stats (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  market_key text NOT NULL,
  window_days integer NOT NULL DEFAULT 365,
  p2_5 numeric(20,8) NOT NULL,
  p50 numeric(20,8) NOT NULL,
  p97_5 numeric(20,8) NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, market_key, window_days)
);

CREATE TABLE market_sources (
  id bigserial PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id),
  market_key text NOT NULL,
  source text NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  staleness_days integer NOT NULL,
  url text,
  parser text,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, market_key, source)
);

CREATE TABLE hijri_calendar (
  gregorian_date date PRIMARY KEY,
  hijri_year integer NOT NULL,
  hijri_month integer NOT NULL,
  hijri_day integer NOT NULL,
  source text NOT NULL DEFAULT 'ummalqura',
  official_override boolean NOT NULL DEFAULT false
);

CREATE TABLE import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  created_by uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'uploaded',
  original_filename text NOT NULL,
  storage_path text NOT NULL,
  column_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  file_sha256 varchar(64),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  CONSTRAINT uq_import_batches_file UNIQUE (tenant_id, file_sha256)
);

CREATE TABLE import_rows (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_index integer NOT NULL,
  raw jsonb NOT NULL,
  normalized jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'staged',
  diff_pct numeric(12,6),
  diff_json jsonb,
  deal_id uuid REFERENCES deals(id),
  accepted boolean NOT NULL DEFAULT false,
  is_golden_approved boolean NOT NULL DEFAULT false,
  recorded_currency varchar(3),
  row_fingerprint varchar(64),
  UNIQUE (batch_id, row_index)
);
CREATE INDEX ix_import_rows_batch ON import_rows (tenant_id, batch_id);
CREATE INDEX ix_import_rows_fingerprint ON import_rows (tenant_id, row_fingerprint);

CREATE TABLE import_column_map (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  kind text NOT NULL,
  mapping jsonb NOT NULL,
  UNIQUE (tenant_id, kind, name)
);

CREATE TABLE job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  job_name text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  reason text,
  rows_affected bigint,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms bigint
);
CREATE INDEX ix_job_runs_name_time ON job_runs (job_name, started_at);
"""

TABLES = [
    "job_runs", "import_column_map", "import_rows", "import_batches", "hijri_calendar",
    "market_sources", "market_price_stats", "model_registry", "tenant_lane_costs", "lane_costs",
    "hs_duty_rates", "product_cost_config", "tenant_cost_config", "audit_log", "fx_rates",
    "market_prices", "quote_anomalies", "predictions", "deal_inputs", "deal_cost_lines", "deals",
    "parties", "products", "api_keys", "users", "tenants",
]


def upgrade() -> None:
    op.execute(SCHEMA)


def downgrade() -> None:
    for t in TABLES:
        op.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
