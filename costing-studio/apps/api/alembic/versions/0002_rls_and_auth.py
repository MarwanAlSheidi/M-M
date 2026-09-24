"""RLS (FORCE, NULLIF-safe) on every tenant table + SECURITY DEFINER lookups.

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

TENANT_TABLES = [
    "users", "api_keys", "products", "parties", "deals", "deal_cost_lines", "deal_inputs",
    "predictions", "quote_anomalies", "market_prices", "audit_log", "tenant_cost_config",
    "product_cost_config", "tenant_lane_costs", "model_registry", "market_price_stats",
    "import_batches", "import_rows", "import_column_map",
]
CUR = "NULLIF(current_setting('app.tenant_id', true), '')::uuid"


def upgrade() -> None:
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
    for t in TENANT_TABLES + ["job_runs"]:
        op.execute(f"DROP POLICY IF EXISTS {t}_tenant ON {t}")
        op.execute(f"ALTER TABLE {t} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} DISABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS tenants_self ON tenants")
    op.execute("ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE tenants DISABLE ROW LEVEL SECURITY")
