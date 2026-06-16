"""SQLAlchemy schema + async engine."""

from __future__ import annotations

import re
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings


class Base(DeclarativeBase):
    pass


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True)
    name = Column(Text, nullable=False)
    slug = Column(Text, nullable=False, unique=True)
    created_at = Column(Text, nullable=False)


class OrgDomain(Base):
    __tablename__ = "org_domains"

    id = Column(Integer, primary_key=True)
    # Email domain (lowercased, e.g. "anacostia.com"). Users with this domain are
    # provisioned into org_id on first login. Add a row to onboard a company —
    # no redeploy. Per-user exceptions live in app_users instead.
    domain = Column(Text, nullable=False, unique=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)


class AppUser(Base):
    __tablename__ = "app_users"

    id = Column(Integer, primary_key=True)
    # The Supabase auth user id (JWT `sub`). The membership is keyed on this, not
    # email, so a user keeps their org even if their email later changes.
    supabase_user_id = Column(Text, nullable=False, unique=True)
    email = Column(Text, nullable=False)
    # Nullable: a user is authenticated before they pick/join an org in onboarding.
    org_id = Column(Integer, ForeignKey("organizations.id"))
    name = Column(Text)
    phone = Column(Text)
    profile_completed = Column(Boolean, nullable=False, server_default="false")
    onboarded_at = Column(Text)
    created_at = Column(Text, nullable=False)


class OrgInviteCode(Base):
    __tablename__ = "org_invite_codes"

    id = Column(Integer, primary_key=True)
    # Stored lowercased; redemption matches case-insensitively. Grants membership
    # to exactly one org — the secret that lets a non-company email join a team.
    code = Column(Text, nullable=False, unique=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    max_uses = Column(Integer)
    used_count = Column(Integer, nullable=False, server_default="0")
    expires_at = Column(Text)
    created_at = Column(Text, nullable=False)


class Asset(Base):
    __tablename__ = "assets"

    id = Column(Integer, primary_key=True)
    # org_id is NOT NULL in the DB after backfill; nullable here only so existing
    # in-memory construction paths don't need to set it before the column lands.
    org_id = Column(Integer, ForeignKey("organizations.id"))
    reporting_mark = Column(Text, nullable=False)
    road_number = Column(Text, nullable=False)
    unit_model = Column(Text, nullable=False)
    in_service_date = Column(Text)
    last_inspection_at = Column(Text)


class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id"))
    asset_id = Column(Integer, ForeignKey("assets.id"))
    status = Column(Text, nullable=False)
    severity = Column(Text, nullable=False, default="major", server_default="major")
    opened_by_role = Column(Text, nullable=False)
    opened_at = Column(Text, nullable=False)
    initial_error_codes = Column(Text)
    initial_symptoms = Column(Text)
    fault_dump_raw = Column(Text)
    fault_dump_parsed = Column(Text)
    pre_arrival_summary = Column(Text)
    closed_at = Column(Text)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (Index("idx_messages_ticket", "ticket_id", "id"),)

    id = Column(Integer, primary_key=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"))
    role = Column(Text, nullable=False)
    content = Column(Text, nullable=False)
    citations = Column(JSONB)
    attachments = Column(JSONB)
    tool_calls = Column(JSONB)
    created_at = Column(Text, nullable=False)
    prev_hash = Column(Text)
    hash = Column(Text, nullable=False)


class Part(Base):
    __tablename__ = "parts"

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id"))
    # part_number is unique per org, not globally — two railroads may stock the
    # same OEM part number. Enforced by a partial unique index in migrate.py.
    part_number = Column(Text, nullable=False)
    name = Column(Text, nullable=False)
    description = Column(Text)
    compatible_units = Column(JSONB, nullable=False)
    bin_location = Column(Text, nullable=False)
    qty_on_hand = Column(Integer, nullable=False)
    supplier = Column(Text)
    lead_time_days = Column(Integer)
    alternate_part_numbers = Column(JSONB)
    last_used_at = Column(Text)


class TicketPart(Base):
    __tablename__ = "ticket_parts"

    id = Column(Integer, primary_key=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"))
    part_id = Column(Integer, ForeignKey("parts.id"))
    qty = Column(Integer, nullable=False)
    added_via = Column(Text, nullable=False)
    added_at = Column(Text, nullable=False)


class CorpusChunk(Base):
    __tablename__ = "corpus_chunks"

    id = Column(Integer, primary_key=True)
    doc_class = Column(Text, nullable=False)
    doc_id = Column(Text, nullable=False)
    doc_title = Column(Text, nullable=False)
    source_label = Column(Text, nullable=False)
    page = Column(Integer)
    text = Column(Text, nullable=False)
    embedding = Column(Vector(1024))
    # null org_id = shared across all orgs (e.g. CFR); non-null = org-private
    org_id = Column(Integer, ForeignKey("organizations.id"))
    # null unit_model = shared across all models; null asset_id = not unit-specific
    unit_model = Column(Text)
    asset_id = Column(Integer, ForeignKey("assets.id"))


class TribalCapture(Base):
    __tablename__ = "tribal_capture"

    id = Column(Integer, primary_key=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"))
    author = Column(Text)
    text = Column(Text, nullable=False)
    captured_at = Column(Text, nullable=False)
    promoted_chunk_id = Column(Integer)


# --- Engine + session helpers ---

_engine: Optional[AsyncEngine] = None
_session_maker: Optional[async_sessionmaker[AsyncSession]] = None


def _to_async_url(raw: str) -> str:
    """Convert a postgres:// or postgresql:// URL into postgresql+asyncpg:// form."""
    url = raw
    # SQLAlchemy prefers postgresql:// over postgres://
    url = re.sub(r"^postgres://", "postgresql://", url)
    if url.startswith("postgresql+"):
        return url
    return url.replace("postgresql://", "postgresql+asyncpg://", 1)


def get_engine() -> AsyncEngine:
    global _engine, _session_maker
    if _engine is not None:
        return _engine
    settings = get_settings()
    raw = settings.database_url
    if not raw:
        raise RuntimeError("DATABASE_URL missing")
    async_url = _to_async_url(raw)
    # Supabase transaction pooler (6543) requires statement_cache_size=0.
    connect_args = {"statement_cache_size": 0}
    _engine = create_async_engine(async_url, connect_args=connect_args, pool_pre_ping=True)
    _session_maker = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)
    return _engine


def get_session_maker() -> async_sessionmaker[AsyncSession]:
    if _session_maker is None:
        get_engine()
    assert _session_maker is not None
    return _session_maker


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    maker = get_session_maker()
    async with maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def close_engine() -> None:
    global _engine, _session_maker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_maker = None
