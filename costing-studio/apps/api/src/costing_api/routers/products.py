from contextlib import contextmanager
from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..deps import get_session, get_tenant, require_admin
from ..schemas import CostElementIn, MarginConfigIn, ProductIn, ProductPatch
from ..services import product_service as svc

router = APIRouter(prefix="/api/v1/products", tags=["products"])


@contextmanager
def http_errors():
    try:
        yield
    except LookupError as e:
        raise HTTPException(404, str(e))
    except svc.Conflict as e:
        raise HTTPException(409, str(e))
    except IntegrityError as e:          # e.g. overlapping validity periods
        raise HTTPException(409, str(e.orig).splitlines()[0])
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.get("")
def list_products(tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    return {"items": svc.list_products(session, tenant["tenant_id"])}


@router.post("", status_code=201)
def create_product(body: ProductIn, tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    require_admin(tenant)
    with http_errors():
        return svc.create_product(session, tenant, body.name, body.category, body.base_unit, body.attributes)


@router.get("/{product_id}")
def get_product(product_id: UUID, as_of: Optional[date] = None, tenant=Depends(get_tenant),
                session: Session = Depends(get_session)):
    with http_errors():
        return svc.product_detail(session, tenant["tenant_id"], product_id, as_of)


@router.patch("/{product_id}")
def patch_product(product_id: UUID, body: ProductPatch, tenant=Depends(get_tenant),
                  session: Session = Depends(get_session)):
    require_admin(tenant)
    with http_errors():
        return svc.update_product(session, tenant, product_id, body.model_dump(exclude_unset=True))


@router.post("/{product_id}/cost-elements", status_code=201)
def add_cost_element(product_id: UUID, body: CostElementIn, tenant=Depends(get_tenant),
                     session: Session = Depends(get_session)):
    require_admin(tenant)
    with http_errors():
        return svc.add_cost_element(session, tenant, product_id, name=body.name, unit=body.unit, rate=body.rate,
                                    currency=body.currency.upper(), valid_from=body.valid_from,
                                    qty_per_unit=body.qty_per_unit)


@router.post("/{product_id}/margin-config", status_code=201)
def set_margin_config(product_id: UUID, body: MarginConfigIn, tenant=Depends(get_tenant),
                      session: Session = Depends(get_session)):
    require_admin(tenant)
    with http_errors():
        return svc.set_margin_config(session, tenant, product_id, body.min_pct, body.target_pct,
                                     body.max_pct, body.valid_from)
