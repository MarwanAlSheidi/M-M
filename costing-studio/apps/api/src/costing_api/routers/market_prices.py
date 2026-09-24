from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..deps import get_session, get_tenant, require_admin
from ..jobs.market_ingest import ingest_csv

router = APIRouter(prefix="/api/v1/market-prices", tags=["market"])


@router.post("/ingest")
def ingest(body: dict, tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    """body: {"market_key": "...", "rows": [{price_major, currency, unit, observed_at}]}"""
    require_admin(tenant)
    rows = []
    for r in body.get("rows") or []:
        rows.append({**r, "observed_at": date.fromisoformat(r["observed_at"])})
    try:
        return ingest_csv(session, tenant["tenant_id"], body["market_key"], rows)
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e))
