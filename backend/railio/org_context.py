"""Per-request organization (tenant) context.

THE single place that decides which org a request belongs to. It verifies the
Supabase access token on the `Authorization: Bearer …` header, resolves (and on
first login provisions) the user's org from app_users, and returns it. The org
is derived solely from the verified token — the client-supplied `X-Org-Id`
header is intentionally ignored, so a client cannot read another org's data.
"""

from __future__ import annotations

from typing import Optional

from fastapi import Header, HTTPException

from .auth import verify_supabase_jwt
from .contract import Organization
from .organizations_repo import get_or_provision_user


async def get_current_org(
    authorization: Optional[str] = Header(default=None),
) -> Organization:
    """Resolve the request's org from the verified Supabase JWT.

    Raises 401 if the token is missing/invalid, and 503 if the resolved org
    hasn't been loaded yet (run scripts.load_org).
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    try:
        claims = verify_supabase_jwt(token)
    except Exception:
        raise HTTPException(status_code=401, detail="invalid token")

    sub = claims.get("sub")
    email = claims.get("email")
    if not sub or not email:
        raise HTTPException(status_code=401, detail="token missing sub/email")

    return await get_or_provision_user(supabase_user_id=str(sub), email=str(email))
