from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..auth import issue_jwt, verify_password
from ..db import SessionLocal
from ..deps import get_session, get_tenant
from ..schemas import LoginRequest, LoginResponse, UserOut

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest):
    # Pre-tenant: users is RLS-protected, so the lookup goes through auth_lookup_user (SECURITY DEFINER).
    with SessionLocal() as s, s.begin():
        row = s.execute(text("SELECT id, tenant_id, role, password_hash FROM auth_lookup_user(:e)"),
                        {"e": req.email.strip()}).first()
        if not verify_password(req.password, row.password_hash if row else None):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid email or password")
        s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(row.tenant_id)})
        u = s.execute(text("SELECT email, locale_pref FROM users WHERE id = :u"), {"u": row.id}).one()
    token, ttl = issue_jwt(row.id, row.tenant_id, row.role, u.locale_pref)
    return LoginResponse(access_token=token, expires_in=ttl, user=UserOut(
        id=str(row.id), tenant_id=str(row.tenant_id), email=u.email, role=row.role, locale=u.locale_pref))


@router.get("/me", response_model=UserOut)
def me(tenant=Depends(get_tenant), session: Session = Depends(get_session)):
    u = session.execute(text("SELECT email, locale_pref FROM users WHERE id = :u"),
                        {"u": tenant["user_id"]}).first()
    if u is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user not found")
    return UserOut(id=tenant["user_id"], tenant_id=tenant["tenant_id"], email=u.email,
                   role=tenant["role"], locale=u.locale_pref)
