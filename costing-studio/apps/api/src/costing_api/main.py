import logging
import os
import subprocess
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .db import SessionLocal

from .routers import admin, auth, envelope, imports, market_prices, parties, predict, products, simulate
from .settings import settings

log = logging.getLogger(__name__)

app = FastAPI(title="Costing Studio API", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
for r in (auth, products, envelope, simulate, market_prices, predict, imports, admin, parties):
    app.include_router(r.router)


@app.get("/health")
def health():
    return {"ok": True}


def _version() -> str:
    """GIT_SHA if set (e.g. baked into an image), else the checkout's short commit, else 'unknown'."""
    if os.environ.get("GIT_SHA"):
        return os.environ["GIT_SHA"]
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=Path(__file__).parent,
                              capture_output=True, text=True, timeout=2, check=True).stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


VERSION = _version()


@app.get("/api/v1/health")
def health_v1():
    """Liveness for scripts/demo.sh and monitors: 200 when Postgres and Redis answer, else 503."""
    out = {"status": "ok", "db": "ok", "redis": "ok", "version": VERSION}
    try:
        with SessionLocal() as s:
            s.execute(text("SELECT 1"))
    except Exception as e:                       # noqa: BLE001  report, don't raise
        out["db"] = f"error: {type(e).__name__}"
    try:
        from .jobs.queue import redis_conn
        redis_conn.ping()
    except Exception as e:                       # noqa: BLE001
        out["redis"] = f"error: {type(e).__name__}"
    if out["db"] != "ok" or out["redis"] != "ok":
        out["status"] = "degraded"
        return JSONResponse(out, status_code=503)
    return out
