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
            c.execute(text("INSERT INTO products (tenant_id, name, category, base_unit) "
                           "VALUES (:t, 'P-' || CAST(:tt AS text), 'test', 'unit') ON CONFLICT DO NOTHING"),
                      {"t": tid, "tt": tid})
            c.execute(text("INSERT INTO cost_elements (tenant_id, product_id, name, unit, rate_minor, currency, "
                           "valid_from) SELECT :t, id, 'e', 'unit', 100, 'OMR', DATE '2024-01-01' "
                           "FROM products WHERE tenant_id = :t2 LIMIT 1 ON CONFLICT DO NOTHING"),
                      {"t": tid, "t2": tid})
    eng.dispose()
    yield
    eng = create_engine(ADMIN_URL)
    with eng.begin() as c:
        for tbl in ("cost_elements", "products", "users"):
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
        for tbl in ("products", "cost_elements", "users"):
            rows = c.execute(text(f"SELECT tenant_id FROM {tbl}")).scalars().all()
            assert rows, f"expected rows for A in {tbl}"
            assert all(str(r) == A for r in rows), f"leak in {tbl}"
    finally:
        _close(eng, c, tx)


def test_no_tenant_set_returns_zero_rows(seeded):
    eng, c, tx = _open(None)
    try:
        for tbl in ("products", "cost_elements", "users", "pricing_snapshots", "market_prices", "tenants"):
            assert c.execute(text(f"SELECT count(*) FROM {tbl}")).scalar() == 0, tbl
    finally:
        _close(eng, c, tx)


def test_insert_with_wrong_tenant_rejected(seeded):
    eng, c, tx = _open(B)
    try:
        with pytest.raises(Exception) as ei:
            c.execute(text("INSERT INTO products (tenant_id, name, category, base_unit) "
                           "VALUES (:a, 'X', 'test', 'unit')"), {"a": A})
        assert "row-level security" in str(ei.value).lower()
    finally:
        _close(eng, c, tx)


def test_policy_count_matches_expectation():
    expected = {
        "tenants", "users", "api_keys", "parties", "products", "cost_elements", "product_bom",
        "margin_config", "market_sources", "market_prices", "pricing_snapshots", "audit_log",
        "model_registry", "import_batches", "import_rows", "import_column_map", "job_runs",
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
            "('hijri_calendar', 'fx_rates')"
        )).all()
    eng.dispose()
    by: dict[str, set] = {}
    for t, p in rows:
        by.setdefault(t, set()).add(p)
    for t in ("hijri_calendar", "fx_rates"):
        assert by.get(t) == {"SELECT"}, f"{t}: {by.get(t)}"


def test_app_role_does_not_bypass_rls():
    eng = create_engine(ADMIN_URL)
    with eng.connect() as c:
        assert c.execute(text("SELECT rolbypassrls FROM pg_roles WHERE rolname = 'costing_app'")).scalar() is False
    eng.dispose()
