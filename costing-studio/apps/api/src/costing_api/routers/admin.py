from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..deps import get_session, get_tenant, require_admin
from ..jobs.enqueue import JOB_NAMES, enqueue

router = APIRouter(prefix="/api/v1/admin/jobs", tags=["jobs"])
GLOBAL_JOBS = {"fx_refresh"}


@router.get("")
def list_runs(limit: int = 50, tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    require_admin(tenant)
    rows = session.execute(text("""
      SELECT id, job_name, status, reason, rows_affected, error, started_at, finished_at, duration_ms
        FROM job_runs WHERE tenant_id = :t ORDER BY started_at DESC LIMIT :l
    """), {"t": tenant["tenant_id"], "l": limit}).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.post("/{job_name}/run")
def trigger(job_name: str, tenant=Depends(get_tenant)):
    require_admin(tenant)
    if job_name not in JOB_NAMES:
        raise HTTPException(404, f"unknown job {job_name}")
    if job_name in GLOBAL_JOBS:
        if tenant.get("role") != "platform_admin":
            raise HTTPException(403, f"{job_name} requires platform admin")
        job = enqueue(job_name, None)
    else:
        job = enqueue(job_name, tenant["tenant_id"])
    return {"job_id": job.id, "status": "queued"}
