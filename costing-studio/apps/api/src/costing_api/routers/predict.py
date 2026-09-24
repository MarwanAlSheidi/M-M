from fastapi import APIRouter, Depends

from ..deps import get_tenant

router = APIRouter(prefix="/api/v1/predict", tags=["predict"])


@router.get("")
def predict_stub(tenant=Depends(get_tenant)):
    """Placeholder. ML predictions are served through /quote."""
    return {"items": []}
