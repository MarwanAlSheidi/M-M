from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..deps import get_session, get_tenant

router = APIRouter(prefix="/api/v1/products", tags=["products"])


@router.get("")
def list_products(tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    rows = session.execute(text(
        "SELECT id, sku, name_en, name_ar, category, base_unit, hs_code, market_key FROM products ORDER BY sku"
    )).mappings().all()
    return {"items": [dict(r) for r in rows]}
