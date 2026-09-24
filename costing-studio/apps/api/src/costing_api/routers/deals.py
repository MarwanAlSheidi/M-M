from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..deps import get_session, get_tenant

router = APIRouter(prefix="/api/v1/deals", tags=["deals"])


@router.get("")
def list_deals(limit: int = 100, tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    rows = session.execute(text("""
      SELECT id, deal_ref, deal_date, quantity, base_unit, incoterm, currency,
             actual_landed_cost_minor, base_currency, is_golden, status
        FROM deals ORDER BY deal_date DESC LIMIT :l
    """), {"l": limit}).mappings().all()
    return {"items": [dict(r) for r in rows]}
