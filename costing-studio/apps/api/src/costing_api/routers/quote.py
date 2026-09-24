from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..deps import get_session, get_tenant
from ..repos.hs_repo import DutyRateNotFound
from ..repos.lane_repo import LaneNotFound
from ..schemas import QuoteRequest, QuoteResponse
from ..services.pricing_mode import PricingMode, choose_mode
from ..services.quote_service import build_quote

router = APIRouter(prefix="/api/v1", tags=["quote"])


@router.post("/quote", response_model=QuoteResponse)
def post_quote(req: QuoteRequest, tenant: dict = Depends(get_tenant),
               session: Session = Depends(get_session)):
    # Sync def: FastAPI runs it in the threadpool (solver is CPU-bound).
    mode = choose_mode(req.purchase_unit_price_major, req.use_ml)
    if mode is PricingMode.NO_PRICE_NO_ML:
        raise HTTPException(422, "No purchase price supplied and ML disabled.")
    try:
        return build_quote(session, tenant, req, mode)
    except (LaneNotFound, DutyRateNotFound, LookupError, ValueError) as e:
        raise HTTPException(422, str(e))
