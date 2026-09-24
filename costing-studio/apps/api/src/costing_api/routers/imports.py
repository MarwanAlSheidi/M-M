from __future__ import annotations
import hashlib
import json
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..deps import get_session, get_tenant
from ..services import import_service as svc
from ..settings import settings

router = APIRouter(prefix="/api/v1/imports", tags=["imports"])
ALLOWED_SUFFIXES = {".xlsx", ".csv"}


def _json(o) -> str:
    return json.dumps(o, default=str)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


@router.post("")
def upload(kind: str = Form(...), file: UploadFile = File(...),
           tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_SUFFIXES:
        raise HTTPException(415, f"unsupported file type {ext}; use .xlsx or .csv")

    batch_id = str(uuid.uuid4())
    dir_path = Path(settings.upload_root) / tenant["tenant_id"] / batch_id
    dir_path.mkdir(parents=True, exist_ok=True)
    dest = dir_path / f"source{ext}"
    max_bytes = settings.max_upload_mb * 1024 * 1024
    size = 0
    with dest.open("wb") as f:
        while chunk := file.file.read(65536):
            size += len(chunk)
            if size > max_bytes:
                dest.unlink(missing_ok=True)
                raise HTTPException(413, f"file exceeds {settings.max_upload_mb} MB")
            f.write(chunk)

    digest = _sha256(dest)
    existing = session.execute(text(
        "SELECT id, status FROM import_batches WHERE tenant_id = :t AND file_sha256 = :h"
    ), {"t": tenant["tenant_id"], "h": digest}).mappings().first()
    if existing:
        dest.unlink(missing_ok=True)
        return {"batch_id": str(existing["id"]), "duplicate": True, "status": existing["status"]}

    df = svc.parse_file(dest)
    if len(df) > settings.max_import_rows:
        dest.unlink(missing_ok=True)
        raise HTTPException(413, f"row count {len(df)} exceeds {settings.max_import_rows}")
    headers = [str(h) for h in df.columns]

    session.execute(text("""
      INSERT INTO import_batches (id, tenant_id, created_by, kind, status, original_filename,
                                  storage_path, column_map, file_sha256, headers)
      VALUES (:id, :t, :u, :k, 'uploaded', :fn, :sp, '{}'::jsonb, :h, CAST(:hd AS jsonb))
    """), {"id": batch_id, "t": tenant["tenant_id"], "u": tenant["user_id"], "k": kind,
           "fn": file.filename, "sp": str(dest), "h": digest, "hd": _json(headers)})
    return {"batch_id": batch_id, "headers": headers,
            "suggested_mapping": svc.suggest_mapping(headers), "row_count": len(df)}


@router.post("/{batch_id}/map")
def set_mapping(batch_id: str, body: dict, tenant=Depends(get_tenant),
                session: Session = Depends(get_session)):
    batch = session.execute(text("SELECT headers FROM import_batches WHERE tenant_id = :t AND id = :b"),
                            {"t": tenant["tenant_id"], "b": batch_id}).mappings().first()
    if not batch:
        raise HTTPException(404, "batch not found")
    headers = list(batch["headers"])
    raw_map = {k: v for k, v in (body.get("column_map") or {}).items() if v}

    bad_keys = set(raw_map) - set(svc.CANONICAL_FIELDS)
    if bad_keys:
        raise HTTPException(400, f"unknown canonical fields: {sorted(bad_keys)}")
    bad_vals = {v for v in raw_map.values() if v not in headers}
    if bad_vals:
        raise HTTPException(400, f"headers not in file: {sorted(bad_vals)}")
    missing = svc.REQUIRED_FIELDS - set(raw_map)
    if missing:
        raise HTTPException(400, f"required fields missing: {sorted(missing)}")

    stored = {"column_map": raw_map, "date_format": body.get("date_format"),
              "dayfirst": bool(body.get("dayfirst", False)), "decimal_sep": body.get("decimal_sep", ".")}
    session.execute(text("""
      UPDATE import_batches SET column_map = CAST(:m AS jsonb), status = 'mapping'
       WHERE tenant_id = :t AND id = :b
    """), {"m": _json(stored), "t": tenant["tenant_id"], "b": batch_id})
    return {"ok": True}


def _insert_row(session, tid, batch_id, i, raw, n, status, diff_pct, diff_json, fp):
    session.execute(text("""
      INSERT INTO import_rows (tenant_id, batch_id, row_index, raw, normalized, status,
                               diff_pct, diff_json, row_fingerprint)
      VALUES (:t, :b, :i, CAST(:r AS jsonb), CAST(:n AS jsonb), :s, :dp, CAST(:dj AS jsonb), :fp)
    """), {"t": tid, "b": batch_id, "i": i, "r": _json(raw), "n": _json(n or {}), "s": status,
           "dp": diff_pct, "dj": _json(diff_json) if diff_json else None, "fp": fp})


@router.post("/{batch_id}/stage")
def stage(batch_id: str, tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    tid = tenant["tenant_id"]
    batch = session.execute(text(
        "SELECT storage_path, column_map FROM import_batches WHERE tenant_id = :t AND id = :b"
    ), {"t": tid, "b": batch_id}).mappings().first()
    if not batch:
        raise HTTPException(404, "batch not found")
    cfg = batch["column_map"] or {}
    col_map = cfg.get("column_map") or {}
    if not col_map:
        raise HTTPException(400, "set the column mapping first")

    df = svc.parse_file(Path(batch["storage_path"]))
    session.execute(text("DELETE FROM import_rows WHERE batch_id = :b AND tenant_id = :t"),
                    {"b": batch_id, "t": tid})
    persisted = set(session.execute(text("""
      SELECT row_fingerprint FROM import_rows
       WHERE tenant_id = :t AND deal_id IS NOT NULL AND row_fingerprint IS NOT NULL
    """), {"t": tid}).scalars().all())
    seen: set[str] = set()
    counts = {"ok": 0, "ok_unverified": 0, "flagged": 0, "rejected": 0}

    for i, row in df.iterrows():
        raw = {k: (None if pd_isna(v) else v) for k, v in row.to_dict().items()}
        try:
            n = svc.normalize_row(raw, col_map, date_format=cfg.get("date_format"),
                                  dayfirst=bool(cfg.get("dayfirst")), decimal_sep=cfg.get("decimal_sep", "."))
            missing = svc.REQUIRED_FIELDS - set(n)
            if missing:
                raise ValueError(f"missing required values: {sorted(missing)}")
            n["_row_index"] = int(i)
            fp = svc.fingerprint(n)
        except Exception as e:
            _insert_row(session, tid, batch_id, int(i), raw, None, "rejected", None, {"error": str(e)}, None)
            counts["rejected"] += 1
            continue
        if fp in persisted or fp in seen:
            reason = "duplicate row: already persisted" if fp in persisted else "duplicate row within file"
            _insert_row(session, tid, batch_id, int(i), raw, n, "rejected", None, {"error": reason}, fp)
            counts["rejected"] += 1
            continue
        seen.add(fp)
        res = svc.recompute_row(session, tid, n)
        counts[res.status] += 1
        _insert_row(session, tid, batch_id, int(i), raw, n, res.status,
                    str(res.diff_pct) if res.diff_pct is not None else None, res.diff_json, fp)

    session.execute(text("UPDATE import_batches SET status = 'staged' WHERE tenant_id = :t AND id = :b"),
                    {"t": tid, "b": batch_id})
    return {"batch_id": batch_id, "counts": counts}


def pd_isna(v) -> bool:
    try:
        import pandas as pd
        return bool(pd.isna(v))
    except (TypeError, ValueError):
        return False


@router.get("/{batch_id}/rows")
def list_rows(batch_id: str, status: str | None = None, tenant=Depends(get_tenant),
              session: Session = Depends(get_session)):
    q = ("SELECT row_index, status, diff_pct, normalized, diff_json, deal_id, accepted, is_golden_approved "
         "FROM import_rows WHERE tenant_id = :t AND batch_id = :b")
    params = {"t": tenant["tenant_id"], "b": batch_id}
    if status:
        q += " AND status = :s"
        params["s"] = status
    rows = session.execute(text(q + " ORDER BY row_index"), params).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.patch("/{batch_id}/rows/{row_index}")
def update_row(batch_id: str, row_index: int, body: dict, tenant=Depends(get_tenant),
               session: Session = Depends(get_session)):
    sets, params = [], {"t": tenant["tenant_id"], "b": batch_id, "i": row_index}
    if body.get("accepted") is not None:
        sets.append("accepted = :a")
        params["a"] = bool(body["accepted"])
    if body.get("is_golden_approved") is not None:
        sets.append("is_golden_approved = :g")
        params["g"] = bool(body["is_golden_approved"])
    if not sets:
        raise HTTPException(400, "no updates")
    res = session.execute(text(f"UPDATE import_rows SET {', '.join(sets)} "
                               "WHERE tenant_id = :t AND batch_id = :b AND row_index = :i"), params)
    if res.rowcount != 1:
        raise HTTPException(404, "row not found")
    return {"ok": True}


@router.post("/{batch_id}/confirm")
def confirm(batch_id: str, tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    return svc.persist_confirmed(session, tenant["tenant_id"], batch_id, tenant["user_id"])
