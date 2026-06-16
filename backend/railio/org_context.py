"""Per-request identity + organization (tenant) context.

Two seams:
  - get_current_user verifies the Supabase JWT and ensures an app_users row
    exists. The user may be un-onboarded (org_id NULL). Used by /api/me and
    /api/onboarding.
  - get_current_org returns the tenant for an ONBOARDED request. Un-onboarded
    users get 409 onboarding_required, so every org-scoped router redirects them
    into onboarding without any router change.

The org is derived solely from the verified token + our DB — the client-supplied
X-Org-Id header is ignored, so a client cannot read another org's data.
"""

from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header, HTTPException

from .auth import verify_supabase_jwt
from .contract import Organization
from .organizations_repo import ensure_user, get_org_by_id


async def get_current_user(
    authorization: Optional[str] = Header(default=None),
) -> dict:
    """Verified Supabase user as an app_users row (may be un-onboarded)."""
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

    user = await ensure_user(supabase_user_id=str(sub), email=str(email))
    user["supabase_user_id"] = str(sub)
    return user


async def get_current_org(
    user: dict = Depends(get_current_user),
) -> Organization:
    """Org for an onboarded request; 409 if the user hasn't onboarded yet."""
    if not user.get("org_id") or not user.get("profile_completed"):
        raise HTTPException(status_code=409, detail="onboarding_required")
    org = await get_org_by_id(int(user["org_id"]))
    if org is None:
        raise HTTPException(status_code=503, detail="org not loaded")
    return org
