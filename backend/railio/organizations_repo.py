"""Organizations (tenant) repo.

An organization is a railroad tenant. Org-private data (assets, tickets, parts
inventory, tribal/repair history) is isolated per org; shared reference data
(CFR) carries org_id = NULL and is visible to every org.
"""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException
from sqlalchemy import text

from .auth import resolve_org_slug
from .contract import Organization
from .db import session_scope
from .messages_repo import _iso_now


async def list_organizations() -> list[Organization]:
    async with session_scope() as session:
        rows = (
            await session.execute(
                text("SELECT id, name, slug, created_at FROM organizations ORDER BY id")
            )
        ).mappings().all()
    return [Organization(**r) for r in rows]


async def get_org_by_id(org_id: int) -> Optional[Organization]:
    async with session_scope() as session:
        row = (
            await session.execute(
                text("SELECT id, name, slug, created_at FROM organizations WHERE id = :id"),
                {"id": org_id},
            )
        ).mappings().first()
    return Organization(**row) if row else None


async def get_org_by_slug(slug: str) -> Optional[Organization]:
    async with session_scope() as session:
        row = (
            await session.execute(
                text("SELECT id, name, slug, created_at FROM organizations WHERE slug = :slug"),
                {"slug": slug},
            )
        ).mappings().first()
    return Organization(**row) if row else None


async def get_default_org() -> Optional[Organization]:
    """The lowest-id org. Used as the fallback tenant until real auth lands."""
    async with session_scope() as session:
        row = (
            await session.execute(
                text("SELECT id, name, slug, created_at FROM organizations ORDER BY id LIMIT 1")
            )
        ).mappings().first()
    return Organization(**row) if row else None


async def get_or_provision_user(
    *, supabase_user_id: str, email: str
) -> Organization:
    """Return the org for a Supabase user, provisioning on first login.

    First login maps the verified email to an org slug (allowlist → domain →
    fallback) and writes the app_users row. Later logins read that row, so
    changing the domain rules never silently moves an existing user.
    """
    async with session_scope() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT o.id, o.name, o.slug, o.created_at
                    FROM app_users u JOIN organizations o ON o.id = u.org_id
                    WHERE u.supabase_user_id = :sub
                    """
                ),
                {"sub": supabase_user_id},
            )
        ).mappings().first()
        if row:
            return Organization(**row)

        slug = resolve_org_slug(email)
        org_row = (
            await session.execute(
                text(
                    "SELECT id, name, slug, created_at FROM organizations WHERE slug = :slug"
                ),
                {"slug": slug},
            )
        ).mappings().first()
        if org_row is None:
            raise HTTPException(
                status_code=503, detail=f"org not provisioned: {slug}"
            )
        await session.execute(
            text(
                """
                INSERT INTO app_users (supabase_user_id, email, org_id, created_at)
                VALUES (:sub, :email, :org, :at)
                ON CONFLICT (supabase_user_id) DO NOTHING
                """
            ),
            {
                "sub": supabase_user_id,
                "email": email.lower(),
                "org": org_row["id"],
                "at": _iso_now(),
            },
        )
        return Organization(**org_row)


async def create_organization(*, name: str, slug: str) -> Organization:
    existing = await get_org_by_slug(slug)
    if existing:
        return existing
    async with session_scope() as session:
        row = (
            await session.execute(
                text(
                    """
                    INSERT INTO organizations (name, slug, created_at)
                    VALUES (:name, :slug, :at)
                    RETURNING id, name, slug, created_at
                    """
                ),
                {"name": name, "slug": slug, "at": _iso_now()},
            )
        ).mappings().first()
    return Organization(**row)
