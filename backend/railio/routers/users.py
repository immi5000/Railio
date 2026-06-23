"""Current-user state + onboarding (secure org-join)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from ..contract import OnboardingBody, Organization
from ..org_context import get_current_org, get_current_user
from ..organizations_repo import (
    finalize_onboarding,
    get_org_by_id,
    list_org_members,
    org_name_for_domain,
)
from ..posthog_client import get_posthog

router = APIRouter()


@router.get("/me")
async def get_me(user: dict = Depends(get_current_user)) -> JSONResponse:
    org = await get_org_by_id(int(user["org_id"])) if user.get("org_id") else None
    locked = (
        await org_name_for_domain(user["email"])
        if not user.get("profile_completed")
        else None
    )
    return JSONResponse(
        {
            "id": user["id"],
            "email": user["email"],
            "name": user.get("name"),
            "phone": user.get("phone"),
            "profile_completed": bool(user.get("profile_completed")),
            "org": org.model_dump() if org else None,
            "locked_company": locked,
        }
    )


@router.get("/org/members")
async def get_org_members(
    org: Organization = Depends(get_current_org),
    user: dict = Depends(get_current_user),
) -> JSONResponse:
    members = await list_org_members(org.id)
    return JSONResponse(
        [
            {
                "id": m["id"],
                "name": m["name"],
                "email": m["email"],
                "is_self": m["id"] == user["id"],
            }
            for m in members
        ]
    )


@router.post("/onboarding")
async def post_onboarding(
    body: OnboardingBody, user: dict = Depends(get_current_user)
) -> JSONResponse:
    if not body.name or not body.name.strip():
        raise HTTPException(status_code=400, detail="name required")
    if user.get("profile_completed"):
        org = await get_org_by_id(int(user["org_id"]))
        return JSONResponse({"org": org.model_dump() if org else None})
    try:
        org = await finalize_onboarding(
            supabase_user_id=user["supabase_user_id"],
            email=user["email"],
            name=body.name,
            phone=body.phone,
            join_code=body.join_code,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    ph = get_posthog()
    if ph:
        distinct_id = user["supabase_user_id"]
        ph.set(distinct_id=distinct_id, properties={"has_phone": bool(body.phone), "org_id": org.id})
        ph.capture(
            distinct_id=distinct_id,
            event="user_onboarded",
            properties={"has_join_code": bool(body.join_code), "has_phone": bool(body.phone)},
        )

    return JSONResponse({"org": org.model_dump()})
