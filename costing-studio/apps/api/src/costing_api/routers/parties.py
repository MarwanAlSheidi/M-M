from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..deps import get_session, get_tenant

router = APIRouter(prefix="/api/v1/parties", tags=["parties"])


@router.get("")
def list_parties(tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    rows = session.execute(text(
        "SELECT id, type, name_en, name_ar, country, currency, terms_days FROM parties ORDER BY name_en"
    )).mappings().all()
    return {"items": [dict(r) for r in rows]}
