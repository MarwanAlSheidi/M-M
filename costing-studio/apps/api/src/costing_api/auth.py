from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt
from fastapi import HTTPException, status

from .settings import settings

_ALGO = "HS256"
# Checked when the email is unknown, so a miss costs the same bcrypt time as a wrong password.
_DUMMY_HASH = bcrypt.hashpw(b"not-a-real-password", bcrypt.gensalt()).decode()


def decode_jwt(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[_ALGO])
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(e)) from None


def issue_jwt(user_id: str, tenant_id: str, role: str, locale: str) -> tuple[str, int]:
    ttl = settings.jwt_ttl_minutes * 60
    now = datetime.now(timezone.utc)
    claims = {"sub": str(user_id), "tenant_id": str(tenant_id), "role": role, "locale": locale,
              "iat": now, "exp": now + timedelta(seconds=ttl)}
    return jwt.encode(claims, settings.jwt_secret, algorithm=_ALGO), ttl


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str | None) -> bool:
    ok = bcrypt.checkpw(password.encode(), (password_hash or _DUMMY_HASH).encode())
    return ok and password_hash is not None
