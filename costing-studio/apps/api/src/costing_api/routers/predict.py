from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..deps import get_session, get_tenant
from ..repos import product_repo
from ..schemas import ForecastOut
from ..services.forecast import TARGET, champion_forecast

router = APIRouter(prefix="/api/v1/predict", tags=["predict"])


@router.get("", response_model=ForecastOut)
def forward_price(product_sku: str, deal_date: Optional[date] = None, currency: str = "USD",
                  tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    """Champion P10/P50/P90 forward purchase price for a product. Advisory only: it is never a
    landed cost and never replaces a supplier quote (use /quote for that)."""
    d = deal_date or date.today()
    try:
        product = product_repo.get_product(session, tenant["tenant_id"], product_sku)
    except LookupError as e:
        raise HTTPException(404, str(e))
    fc, skip = champion_forecast(session, tenant["tenant_id"], product, d, currency)
    out = ForecastOut(available=fc is not None, reason=skip, product_sku=product_sku, deal_date=d, target=TARGET)
    if fc:
        out = out.model_copy(update=dict(
            model_version=fc.model_version, target_currency=fc.target_currency, target_unit=fc.target_unit,
            p10=str(fc.p10), p50=str(fc.p50), p90=str(fc.p90), shap_top5=fc.shap_top5))
    return out
