import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import admin, auth, envelope, imports, market_prices, parties, predict, products
from .settings import settings

log = logging.getLogger(__name__)

app = FastAPI(title="Costing Studio API", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
for r in (auth, products, envelope, market_prices, predict, imports, admin, parties):
    app.include_router(r.router)


@app.get("/health")
def health():
    return {"ok": True}
