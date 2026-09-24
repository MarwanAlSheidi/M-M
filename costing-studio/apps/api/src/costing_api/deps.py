from __future__ import annotations
from typing import Iterator

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from .auth import decode_jwt
from .db import SessionLocal


def get_tenant(authorization: str = Header(...)) -> dict:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad header")
    claims = decode_jwt(authorization.removeprefix("Bearer "))
    return {
        "tenant_id": str(claims["tenant_id"]),
        "user_id": str(claims["sub"]),
        "role": claims.get("role", "user"),
        "locale": claims.get("locale", "en"),
    }


def get_session(tenant: dict = Depends(get_tenant)) -> Iterator[Session]:
    """One transaction per request with app.tenant_id set (RLS)."""
    with SessionLocal() as session:
        with session.begin():
            session.execute(text("SELECT set_config('app.tenant_id', :t, true)"),
                            {"t": tenant["tenant_id"]})
            yield session


def require_admin(tenant: dict) -> None:
    if tenant.get("role") not in ("admin", "platform_admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin only")
