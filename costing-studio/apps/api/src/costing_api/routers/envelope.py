from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..deps import get_session, get_tenant
from ..i18n import narrative
from ..schemas import EnvelopeRequest
from ..services import envelope_service as svc

router = APIRouter(prefix="/api/v1/envelope", tags=["envelope"])


@router.post("")
def compute(req: EnvelopeRequest, tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    """Compute the envelope (floor / target / ceiling) and, when fresh market prices exist,
    the position vs market. Every call is stored as a pricing snapshot."""
    try:
        out = svc.build_envelope(session, tenant["tenant_id"], req.product_id, req.as_of, computed_by="api")
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:              # includes EnvelopeNotConfigured
        raise HTTPException(422, str(e))
    return {**out, "explanation": narrative(out, tenant.get("locale", "en"))}


@router.get("/{product_id}")
def latest(product_id: UUID, tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    out = svc.latest_snapshot(session, tenant["tenant_id"], product_id)
    if out is None:
        raise HTTPException(404, "no envelope computed for this product yet")
    return {**out, "explanation": narrative(out, tenant.get("locale", "en"))}
