"""Per-request organization (tenant) context.

THE single place that decides which org a request belongs to. Today it reads an
`X-Org-Id` header (numeric id or slug) and falls back to the default org when
absent. When real auth lands, swap the header read for a JWT-claim read here —
nothing else in the codebase needs to change.
"""

from __future__ import annotations

from typing import Optional

from fastapi import Header, HTTPException

from .contract import Organization
from .organizations_repo import get_default_org, get_org_by_id, get_org_by_slug


async def get_current_org(
    x_org_id: Optional[str] = Header(default=None, alias="X-Org-Id"),
) -> Organization:
    """Resolve the request's org from the X-Org-Id header, else the default org.

    Raises 400 if the header names an org that doesn't exist, and 503 if no org
    exists at all (the system hasn't been seeded yet).
    """
    org: Optional[Organization] = None
    if x_org_id is not None and x_org_id.strip():
        token = x_org_id.strip()
        if token.isdigit():
            org = await get_org_by_id(int(token))
        else:
            org = await get_org_by_slug(token)
        if org is None:
            raise HTTPException(status_code=400, detail=f"unknown organization: {token}")
        return org

    org = await get_default_org()
    if org is None:
        raise HTTPException(status_code=503, detail="no organizations configured")
    return org
