"""Organizations (tenant) repo.

An organization is a railroad tenant. Org-private data (assets, tickets, parts
inventory, tribal/repair history) is isolated per org; shared reference data
(CFR) carries org_id = NULL and is visible to every org.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import text

from .auth import auto_org_for_email, split_email
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


async def _org_by_id(session, org_id: int) -> Organization:
    row = (
        await session.execute(
            text("SELECT id, name, slug, created_at FROM organizations WHERE id = :id"),
            {"id": org_id},
        )
    ).mappings().first()
    return Organization(**row)


async def _auto_create_org(session, email: str) -> int:
    """Create (or reuse) the org an unmapped email should land in, return its id.

    Company domain → org named after the domain label; public email → personal
    org named after the username. Slug collisions get a -2, -3, … suffix.
    """
    base_slug, name = auto_org_for_email(email)
    slug = base_slug
    n = 1
    while True:
        existing = (
            await session.execute(
                text("SELECT id FROM organizations WHERE slug = :slug"),
                {"slug": slug},
            )
        ).scalar()
        if existing is not None:
            return int(existing)
        try:
            new_id = (
                await session.execute(
                    text(
                        """
                        INSERT INTO organizations (name, slug, created_at)
                        VALUES (:name, :slug, :at)
                        ON CONFLICT (slug) DO NOTHING
                        RETURNING id
                        """
                    ),
                    {"name": name or slug, "slug": slug, "at": _iso_now()},
                )
            ).scalar()
        except Exception:
            new_id = None
        if new_id is not None:
            return int(new_id)
        # Lost a race or slug now taken — bump the suffix and retry.
        n += 1
        slug = f"{base_slug}-{n}"


async def get_or_provision_user(
    *, supabase_user_id: str, email: str
) -> Organization:
    """Return the org for a Supabase user, provisioning on first login.

    Resolution order, all DB-driven (no env, no redeploy to onboard):
      1. existing app_users row (per-user override you can edit in the DB)
      2. an org_domains rule matching the email's domain
      3. auto-create an org (company domain → domain label; public email →
         username) and join it.
    Later logins read the persisted app_users row, so editing org_domains never
    silently moves an existing user.
    """
    _, domain = split_email(email)
    async with session_scope() as session:
        existing = (
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
        if existing:
            return Organization(**existing)

        org_id = (
            await session.execute(
                text("SELECT org_id FROM org_domains WHERE domain = :domain"),
                {"domain": domain},
            )
        ).scalar()
        if org_id is None:
            org_id = await _auto_create_org(session, email)

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
                "org": int(org_id),
                "at": _iso_now(),
            },
        )
        return await _org_by_id(session, int(org_id))


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
