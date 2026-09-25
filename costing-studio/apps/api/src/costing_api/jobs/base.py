"""Job runner: per-tenant lock, job_runs bookkeeping, one transaction with tenant set.
Rule: jobs receive a session already inside a transaction and never call session.begin()."""
from __future__ import annotations
import importlib
import logging
import time
import uuid
from contextlib import contextmanager

from sqlalchemy import text

from ..db import SessionLocal
from .locks import tenant_lock

log = logging.getLogger(__name__)

JOB_MODULES = {
    "fx_refresh": "fx_refresh",
    "market_refresh": "market_refresh",
    "envelope_recompute": "envelope_recompute",
    "retrain": "retrain",
}


@contextmanager
def tenant_session(tenant_id: str | None):
    s = SessionLocal()
    try:
        with s.begin():
            if tenant_id:
                s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tenant_id})
            yield s
    finally:
        s.close()


def run_job(job_name: str, tenant_id: str | None):
    fn = importlib.import_module(f"{__package__}.{JOB_MODULES[job_name]}").run
    with tenant_lock(tenant_id or "global", job_name) as got:
        if not got:
            _record(job_name, tenant_id, "skipped", reason="lock held by another run")
            return
        run_id = _start(job_name, tenant_id)
        t0 = time.monotonic()
        try:
            with tenant_session(tenant_id) as s:
                result = fn(s, tenant_id=tenant_id) or {}
            status = "skipped" if result.get("skipped") else "success"
            _finish(run_id, tenant_id, status, reason=result.get("reason"), rows_affected=result.get("rows"))
        except Exception as e:
            log.exception("job failed: %s tenant=%s", job_name, tenant_id)
            _finish(run_id, tenant_id, "failed", error=str(e)[:4000])
            raise
        finally:
            _update(run_id, tenant_id, "duration_ms = :m", {"m": int((time.monotonic() - t0) * 1000)})


def _start(job_name, tenant_id) -> str:
    rid = str(uuid.uuid4())
    with tenant_session(tenant_id) as s:
        s.execute(text("INSERT INTO job_runs (id, tenant_id, job_name, status) VALUES (:id, :t, :n, 'running')"),
                  {"id": rid, "t": tenant_id, "n": job_name})
    return rid


def _update(run_id, tenant_id, sets: str, params: dict):
    with tenant_session(tenant_id) as s:
        res = s.execute(text(f"UPDATE job_runs SET {sets} WHERE id = :id"), {"id": run_id, **params})
        if res.rowcount != 1:
            raise RuntimeError(f"job_runs update affected {res.rowcount} rows for id={run_id}")


def _finish(run_id, tenant_id, status, reason=None, error=None, rows_affected=None):
    _update(run_id, tenant_id,
            "status = :s, reason = :r, error = :e, rows_affected = :ra, finished_at = now()",
            {"s": status, "r": reason, "e": error, "ra": rows_affected})


def _record(job_name, tenant_id, status, reason=None):
    with tenant_session(tenant_id) as s:
        s.execute(text("""
          INSERT INTO job_runs (id, tenant_id, job_name, status, reason, finished_at)
          VALUES (:id, :t, :n, :s, :r, now())
        """), {"id": str(uuid.uuid4()), "t": tenant_id, "n": job_name, "s": status, "r": reason})
