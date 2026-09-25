"""Product-agnostic pricing-envelope schema. Replaces 0001-0005 (the tuna schema is gone).

Infrastructure tables (tenants, users, api_keys, parties, audit_log, fx_rates, hijri_calendar,
model_registry, import_*, job_runs) and the RLS / SECURITY DEFINER mechanics are carried over
unchanged; only the domain tables differ.

Revision ID: 0006
Revises:
"""
from alembic import op

revision = "0006"
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

-- ---------------------------------------------------------------- domain
-- A product is data: anything industry-specific lives in attributes or in cost_elements rows.
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  category text NOT NULL,
  base_unit varchar(20) NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_products_name UNIQUE (tenant_id, name),
  CONSTRAINT uq_products_id_tenant UNIQUE (id, tenant_id)
);

-- rate_minor is per `unit` of this element; the engine multiplies by product_bom.qty_per_unit
-- (1 when the element has no BOM row, i.e. it is priced per product unit).
CREATE TABLE cost_elements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_id uuid NOT NULL,
  name text NOT NULL,
  unit varchar(20) NOT NULL,
  rate_minor bigint NOT NULL CHECK (rate_minor >= 0),
  currency varchar(3) NOT NULL,
  valid_from date NOT NULL,
  valid_to date,
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT uq_cost_elements_id_tenant UNIQUE (id, tenant_id),
  FOREIGN KEY (product_id, tenant_id) REFERENCES products(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT ex_cost_element_period EXCLUDE USING gist (
    tenant_id WITH =, product_id WITH =, name WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date)) WITH &&)
);
CREATE INDEX ix_cost_elements_product ON cost_elements (tenant_id, product_id);

CREATE TABLE product_bom (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_id uuid NOT NULL,
  cost_element_id uuid NOT NULL,
  qty_per_unit numeric(20,6) NOT NULL CHECK (qty_per_unit >= 0),
  CONSTRAINT uq_bom_element UNIQUE (cost_element_id),
  FOREIGN KEY (product_id, tenant_id) REFERENCES products(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (cost_element_id, tenant_id) REFERENCES cost_elements(id, tenant_id) ON DELETE CASCADE
);

-- Margin on price: floor/target/ceiling = unit_cost / (1 - pct).
-- max_pct NULL -> ceiling = target + (target - floor).
CREATE TABLE margin_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_id uuid NOT NULL,
  min_pct numeric(6,4) NOT NULL,
  target_pct numeric(6,4) NOT NULL,
  max_pct numeric(6,4),
  valid_from date NOT NULL,
  valid_to date,
  CHECK (0 <= min_pct AND min_pct < target_pct AND target_pct < 1),
  CHECK (max_pct IS NULL OR (target_pct < max_pct AND max_pct < 1)),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  FOREIGN KEY (product_id, tenant_id) REFERENCES products(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT ex_margin_period EXCLUDE USING gist (
    tenant_id WITH =, product_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date)) WITH &&)
);

CREATE TABLE market_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_id uuid NOT NULL,
  source text NOT NULL,
  url text,
  parser text,
  frequency text NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  staleness_days integer NOT NULL CHECK (staleness_days > 0),
  active boolean NOT NULL DEFAULT true,
  CONSTRAINT uq_market_sources UNIQUE (tenant_id, product_id, source),
  FOREIGN KEY (product_id, tenant_id) REFERENCES products(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE market_prices (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_id uuid NOT NULL,
  source text NOT NULL,
  price_minor bigint NOT NULL CHECK (price_minor > 0),
  currency varchar(3) NOT NULL,
  unit varchar(20) NOT NULL,
  observed_at date NOT NULL,
  CONSTRAINT uq_market_prices_obs UNIQUE (tenant_id, product_id, source, observed_at),
  FOREIGN KEY (product_id, tenant_id) REFERENCES products(id, tenant_id) ON DELETE CASCADE
);

-- Every envelope computation (API or nightly job), for audit and ML.
CREATE TABLE pricing_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_id uuid NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  computed_by text NOT NULL DEFAULT 'api',
  currency varchar(3) NOT NULL,
  unit_cost_minor bigint NOT NULL,
  floor_minor bigint NOT NULL,
  target_minor bigint NOT NULL,
  ceiling_minor bigint NOT NULL,
  market_reference_minor bigint,
  position text CHECK (position IN ('attractive','too_high','too_low','not_viable')),
  inputs_snapshot jsonb NOT NULL,
  CHECK (floor_minor < target_minor AND target_minor < ceiling_minor),
  CHECK ((market_reference_minor IS NULL) = (position IS NULL)),
  FOREIGN KEY (product_id, tenant_id) REFERENCES products(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX ix_pricing_snapshots_latest ON pricing_snapshots (tenant_id, product_id, computed_at DESC);

-- ---------------------------------------------------------------- infrastructure
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

CREATE TABLE model_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  target text NOT NULL,
  version text NOT NULL,
  artifact_path text NOT NULL,
  target_currency varchar(3) NOT NULL,
  target_unit varchar(20) NOT NULL,
  library_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_champion boolean NOT NULL DEFAULT false,
  promoted_at timestamptz,
  UNIQUE (tenant_id, target, version)
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
  cost_element_id uuid REFERENCES cost_elements(id) ON DELETE SET NULL,
  accepted boolean NOT NULL DEFAULT false,
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

# RLS: same mechanics as the old 0002 (FORCE, NULLIF-safe); only the table list changed.
TENANT_TABLES = [
    "users", "api_keys", "parties", "products", "cost_elements", "product_bom", "margin_config",
    "market_sources", "market_prices", "pricing_snapshots", "audit_log", "model_registry",
    "import_batches", "import_rows", "import_column_map",
]
CUR = "NULLIF(current_setting('app.tenant_id', true), '')::uuid"

TABLES = [
    "job_runs", "import_column_map", "import_rows", "import_batches", "hijri_calendar",
    "model_registry", "audit_log", "fx_rates", "pricing_snapshots", "market_prices",
    "market_sources", "margin_config", "product_bom", "cost_elements", "products", "parties",
    "api_keys", "users", "tenants",
]


def upgrade() -> None:
    op.execute(SCHEMA)

    for t in TENANT_TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(f"CREATE POLICY {t}_tenant ON {t} USING (tenant_id = {CUR}) WITH CHECK (tenant_id = {CUR})")

    op.execute("ALTER TABLE tenants ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE tenants FORCE ROW LEVEL SECURITY")
    op.execute(f"CREATE POLICY tenants_self ON tenants USING (id = {CUR}) WITH CHECK (id = {CUR})")

    # job_runs: tenant rows are private; global rows (tenant_id NULL) are shared.
    op.execute("ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE job_runs FORCE ROW LEVEL SECURITY")
    op.execute(f"CREATE POLICY job_runs_tenant ON job_runs "
               f"USING (tenant_id IS NULL OR tenant_id = {CUR}) "
               f"WITH CHECK (tenant_id IS NULL OR tenant_id = {CUR})")

    # Pre-tenant lookups (login, API keys, scheduler fan-out). Owned by the migrator
    # (BYPASSRLS); search_path pinned; only minimal columns returned.
    op.execute("""
      CREATE FUNCTION auth_lookup_user(p_email text)
      RETURNS TABLE (id uuid, tenant_id uuid, role text, password_hash text)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        SELECT u.id, u.tenant_id, u.role, u.password_hash FROM public.users u
         WHERE lower(u.email) = lower(p_email) LIMIT 1;
      $$;
      CREATE FUNCTION auth_lookup_api_key(p_key_hash text)
      RETURNS TABLE (id uuid, tenant_id uuid, scopes jsonb)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        SELECT k.id, k.tenant_id, k.scopes FROM public.api_keys k
         WHERE k.key_hash = p_key_hash AND k.revoked_at IS NULL LIMIT 1;
      $$;
      CREATE FUNCTION list_tenant_ids()
      RETURNS TABLE (id uuid)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        SELECT t.id FROM public.tenants t;
      $$;
      REVOKE ALL ON FUNCTION auth_lookup_user(text) FROM PUBLIC;
      REVOKE ALL ON FUNCTION auth_lookup_api_key(text) FROM PUBLIC;
      REVOKE ALL ON FUNCTION list_tenant_ids() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION auth_lookup_user(text) TO costing_app;
      GRANT EXECUTE ON FUNCTION auth_lookup_api_key(text) TO costing_app;
      GRANT EXECUTE ON FUNCTION list_tenant_ids() TO costing_app;
    """)


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS list_tenant_ids(); "
               "DROP FUNCTION IF EXISTS auth_lookup_api_key(text); "
               "DROP FUNCTION IF EXISTS auth_lookup_user(text);")
    for t in TABLES:
        op.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
