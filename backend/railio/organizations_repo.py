"""Organizations (tenant) repo.

An organization is a railroad tenant. Org-private data (assets, tickets, parts
inventory, tribal/repair history) is isolated per org; shared reference data
(CFR) carries org_id = NULL and is visible to every org.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import text

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
