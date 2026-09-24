from __future__ import annotations
from typing import Any

import jwt
from fastapi import HTTPException, status

from .settings import settings

_ALGO = "HS256"


def decode_jwt(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[_ALGO])
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(e)) from None
