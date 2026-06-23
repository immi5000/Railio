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


async def list_org_members(org_id: int) -> list[dict]:
    """Onboarded users belonging to an org, for the dashboard team roster."""
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT id, name, email
                    FROM app_users
                    WHERE org_id = :org AND profile_completed = true
                    ORDER BY name NULLS LAST, email
                    """
                ),
                {"org": org_id},
            )
        ).mappings().all()
    return [dict(r) for r in rows]


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


async def ensure_user(*, supabase_user_id: str, email: str) -> dict:
    """Ensure an app_users row exists for this Supabase user; return its state.

    Does NOT choose an org — a new user has org_id = NULL until onboarding
    finalizes. Returns id, email, name, phone, profile_completed, org_id.
    """
    async with session_scope() as session:
        await session.execute(
            text(
                """
                INSERT INTO app_users (supabase_user_id, email, created_at, profile_completed)
                VALUES (:sub, :email, :at, false)
                ON CONFLICT (supabase_user_id) DO NOTHING
                """
            ),
            {"sub": supabase_user_id, "email": email.lower(), "at": _iso_now()},
        )
        row = (
            await session.execute(
                text(
                    """
                    SELECT id, email, name, phone, profile_completed, org_id
                    FROM app_users WHERE supabase_user_id = :sub
                    """
                ),
                {"sub": supabase_user_id},
            )
        ).mappings().first()
    return dict(row)


async def redeem_invite_code(session, code: str) -> Optional[int]:
    """Validate an invite code and return its org_id, or None if invalid.

    Atomic: the guarded UPDATE checks usability (not expired, under max_uses)
    and increments used_count in one statement, so concurrent redemptions can't
    exceed max_uses. Code match is case-insensitive.
    """
    normalized = code.strip().lower()
    if not normalized:
        return None
    org_id = (
        await session.execute(
            text(
                """
                UPDATE org_invite_codes
                SET used_count = used_count + 1
                WHERE lower(code) = :code
                  AND (expires_at IS NULL OR expires_at > :now)
                  AND (max_uses IS NULL OR used_count < max_uses)
                RETURNING org_id
                """
            ),
            {"code": normalized, "now": _iso_now()},
        )
    ).scalar()
    return int(org_id) if org_id is not None else None


async def finalize_onboarding(
    *,
    supabase_user_id: str,
    email: str,
    name: str,
    phone: Optional[str],
    join_code: Optional[str],
) -> Organization:
    """Resolve the user's org on the backend and complete their profile.

    Secure resolution order (client cannot pick an arbitrary org):
      1. org_domains rule for the VERIFIED email domain — authoritative.
      2. a valid invite code — joins that code's org (invalid → ValueError).
      3. neither — auto-create the user's personal/company org.
    """
    _, domain = split_email(email)
    async with session_scope() as session:
        org_id = (
            await session.execute(
                text("SELECT org_id FROM org_domains WHERE domain = :d"),
                {"d": domain},
            )
        ).scalar()

        if org_id is None and join_code and join_code.strip():
            org_id = await redeem_invite_code(session, join_code)
            if org_id is None:
                raise ValueError("invalid join code")

        if org_id is None:
            org_id = await _auto_create_org(session, email)

        await session.execute(
            text(
                """
                UPDATE app_users
                SET org_id = :org, name = :name, phone = :phone,
                    profile_completed = true, onboarded_at = :at
                WHERE supabase_user_id = :sub
                """
            ),
            {
                "org": int(org_id),
                "name": name.strip(),
                "phone": (phone.strip() if phone and phone.strip() else None),
                "at": _iso_now(),
                "sub": supabase_user_id,
            },
        )
        return await _org_by_id(session, int(org_id))


async def org_name_for_domain(email: str) -> Optional[str]:
    """Display name of the org an email's domain maps to (for the locked company
    step), or None. Advisory only — finalize_onboarding re-decides server-side."""
    _, domain = split_email(email)
    async with session_scope() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT o.name FROM org_domains d
                    JOIN organizations o ON o.id = d.org_id
                    WHERE d.domain = :d
                    """
                ),
                {"d": domain},
            )
        ).mappings().first()
    return row["name"] if row else None


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
