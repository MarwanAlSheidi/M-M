import csv
import io
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..deps import get_session, get_tenant, require_admin
from ..jobs.market_refresh import ingest_rows
from ..repos import product_repo
from ..schemas import MarketPriceIn

router = APIRouter(prefix="/api/v1/market-prices", tags=["market"])
CSV_COLUMNS = {"observed_at", "price", "currency", "unit"}
MAX_CSV_BYTES = 2 * 1024 * 1024


class IngestBody(BaseModel):
    product_id: UUID
    source: str = Field(default="manual", min_length=1, max_length=100)
    rows: list[MarketPriceIn]


def _ingest(session, tenant, product_id, source, rows):
    require_admin(tenant)
    try:
        product_repo.get_product(session, tenant["tenant_id"], product_id)
        return ingest_rows(session, tenant["tenant_id"], product_id, source, rows)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/ingest")
def ingest(body: IngestBody, tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    return _ingest(session, tenant, body.product_id, body.source, [r.model_dump() for r in body.rows])


@router.post("/ingest-csv")
def ingest_csv(product_id: UUID = Form(...), source: str = Form("manual"), file: UploadFile = File(...),
               tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    """CSV columns: observed_at (YYYY-MM-DD), price (major units), currency, unit."""
    raw = file.file.read(MAX_CSV_BYTES + 1)
    if len(raw) > MAX_CSV_BYTES:
        raise HTTPException(413, "CSV too large")
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    missing = CSV_COLUMNS - {c.strip() for c in (reader.fieldnames or [])}
    if missing:
        raise HTTPException(422, f"CSV missing columns: {sorted(missing)}")
    rows = []
    for i, r in enumerate(reader):
        r = {k.strip(): (v or "").strip() for k, v in r.items() if k}
        try:
            rows.append({"price": r["price"], "currency": r["currency"].upper(), "unit": r["unit"],
                         "observed_at": date.fromisoformat(r["observed_at"])})
        except ValueError as e:
            raise HTTPException(422, f"row {i}: {e}")
    return _ingest(session, tenant, product_id, source.strip() or "manual", rows)
