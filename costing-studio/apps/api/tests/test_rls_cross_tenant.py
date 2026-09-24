"""Cross-tenant RLS proof. Needs APP_DATABASE_URL (costing_app) and ADMIN_DATABASE_URL (superuser)."""
from __future__ import annotations
import os

import pytest
from sqlalchemy import create_engine, text

APP_URL = os.environ.get("APP_DATABASE_URL")
ADMIN_URL = os.environ.get("ADMIN_DATABASE_URL")
pytestmark = pytest.mark.skipif(not (APP_URL and ADMIN_URL), reason="DB URLs not set")

A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"


@pytest.fixture(scope="module")
def seeded():
    eng = create_engine(ADMIN_URL)
    with eng.begin() as c:
        for tid, name in ((A, "Tenant A"), (B, "Tenant B")):
            c.execute(text("INSERT INTO tenants (id, name, base_currency) VALUES (:i, :n, 'OMR') "
                           "ON CONFLICT (id) DO NOTHING"), {"i": tid, "n": name})
            c.execute(text("INSERT INTO users (tenant_id, email, role) "
                           "VALUES (:t, CAST(:tt AS text) || '@rls.test', 'admin') ON CONFLICT DO NOTHING"),
                      {"t": tid, "tt": tid})
            c.execute(text("INSERT INTO products (tenant_id, sku, name_en, name_ar, category, base_unit, "
                           "hs_code, market_key) VALUES (:t, 'SKU-' || CAST(:tt AS text), 'p', 'p', 'seafood', "
                           "'kg', '0303.42', 'MK') ON CONFLICT DO NOTHING"), {"t": tid, "tt": tid})
            c.execute(text("INSERT INTO deals (tenant_id, deal_ref, product_id, quantity, base_unit, incoterm, "
                           "origin_country, dest_country, deal_date, currency, base_currency) "
                           "SELECT :t, 'D-' || CAST(:tt AS text), id, 1, 'kg', 'CFR', 'TH', 'OM', "
                           "DATE '2024-01-01', 'USD', 'OMR' FROM products WHERE tenant_id = :t LIMIT 1 "
                           "ON CONFLICT DO NOTHING"), {"t": tid, "tt": tid})
    eng.dispose()
    yield
    eng = create_engine(ADMIN_URL)
    with eng.begin() as c:
        for tbl in ("deal_cost_lines", "deals", "products", "users"):
            c.execute(text(f"DELETE FROM {tbl} WHERE tenant_id IN (:a, :b)"), {"a": A, "b": B})
        c.execute(text("DELETE FROM tenants WHERE id IN (:a, :b)"), {"a": A, "b": B})
    eng.dispose()


def _open(tenant):
    eng = create_engine(APP_URL)
    conn = eng.connect()
    tx = conn.begin()
    if tenant:
        conn.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tenant})
    return eng, conn, tx


def _close(eng, conn, tx):
    tx.rollback()
    conn.close()
    eng.dispose()


def test_tenant_a_only_sees_a(seeded):
    eng, c, tx = _open(A)
    try:
        for tbl in ("products", "deals", "users"):
            rows = c.execute(text(f"SELECT tenant_id FROM {tbl}")).scalars().all()
            assert rows, f"expected rows for A in {tbl}"
            assert all(str(r) == A for r in rows), f"leak in {tbl}"
    finally:
        _close(eng, c, tx)


def test_no_tenant_set_returns_zero_rows(seeded):
    eng, c, tx = _open(None)
    try:
        for tbl in ("products", "deals", "users", "deal_cost_lines", "tenants"):
            assert c.execute(text(f"SELECT count(*) FROM {tbl}")).scalar() == 0, tbl
    finally:
        _close(eng, c, tx)


def test_insert_with_wrong_tenant_rejected(seeded):
    eng, c, tx = _open(B)
    try:
        with pytest.raises(Exception) as ei:
            c.execute(text("INSERT INTO products (tenant_id, sku, name_en, name_ar, category, base_unit, "
                           "hs_code, market_key) VALUES (:a, 'X', 'x', 'x', 'seafood', 'kg', '0303.42', 'MK')"),
                      {"a": A})
        assert "row-level security" in str(ei.value).lower()
    finally:
        _close(eng, c, tx)


def test_policy_count_matches_expectation():
    expected = {
        "tenants", "users", "api_keys", "products", "parties", "deals", "deal_cost_lines", "deal_inputs",
        "predictions", "quote_anomalies", "market_prices", "audit_log", "tenant_cost_config",
        "product_cost_config", "tenant_lane_costs", "model_registry", "market_price_stats",
        "import_batches", "import_rows", "import_column_map", "job_runs",
    }
    eng = create_engine(ADMIN_URL)
    with eng.connect() as c:
        got = set(c.execute(text(
            r"SELECT tablename FROM pg_policies WHERE schemaname = 'public' "
            r"AND (policyname LIKE '%\_tenant' OR policyname = 'tenants_self')"
        )).scalars().all())
    eng.dispose()
    assert got == expected, f"missing={expected - got} extra={got - expected}"


def test_reference_tables_are_select_only():
    eng = create_engine(ADMIN_URL)
    with eng.connect() as c:
        rows = c.execute(text(
            "SELECT table_name, privilege_type FROM information_schema.role_table_grants "
            "WHERE grantee = 'costing_app' AND table_name IN "
            "('hs_duty_rates', 'lane_costs', 'hijri_calendar', 'fx_rates')"
        )).all()
    eng.dispose()
    by: dict[str, set] = {}
    for t, p in rows:
        by.setdefault(t, set()).add(p)
    for t in ("hs_duty_rates", "lane_costs", "hijri_calendar", "fx_rates"):
        assert by.get(t) == {"SELECT"}, f"{t}: {by.get(t)}"


def test_app_role_does_not_bypass_rls():
    eng = create_engine(ADMIN_URL)
    with eng.connect() as c:
        assert c.execute(text("SELECT rolbypassrls FROM pg_roles WHERE rolname = 'costing_app'")).scalar() is False
    eng.dispose()
