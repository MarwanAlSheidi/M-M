import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .db import SessionLocal
from .routers import admin, auth, deals, imports, market_prices, parties, predict, products, quote
from .settings import settings

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.env == "prod":
        with SessionLocal() as s:
            n = s.execute(text("SELECT count(*) FROM hs_duty_rates WHERE NOT verified")).scalar()
        if n:
            raise RuntimeError(f"{n} unverified hs_duty_rates rows in prod. Refusing to start.")
    yield


app = FastAPI(title="Costing Studio API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
for r in (auth, deals, products, parties, quote, predict, imports, admin, market_prices):
    app.include_router(r.router)


@app.get("/health")
def health():
    return {"ok": True}
