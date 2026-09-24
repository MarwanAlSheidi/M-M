from __future__ import annotations
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .settings import settings

_engine_app = create_engine(settings.database_url, pool_pre_ping=True, pool_size=10)
SessionLocal = sessionmaker(_engine_app, expire_on_commit=False)

_engine_worker = None


def WorkerSessionLocal():
    """costing_worker session, for global reference writes (fx_rates)."""
    global _engine_worker
    if not settings.worker_database_url:
        raise RuntimeError("WORKER_DATABASE_URL must be set for this job")
    if _engine_worker is None:
        _engine_worker = create_engine(settings.worker_database_url, pool_pre_ping=True, pool_size=2)
    return sessionmaker(_engine_worker, expire_on_commit=False)()
