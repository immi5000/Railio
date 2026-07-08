"""SQLAlchemy schema + async engine."""

from __future__ import annotations

import re
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    ARRAY,
    JSON,
    Boolean,
    Column,
    ForeignKey,
    Index,
    Integer,
    Numeric,
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
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)


class AppUser(Base):
    __tablename__ = "app_users"

    id = Column(Integer, primary_key=True)
    # The Supabase auth user id (JWT `sub`). The membership is keyed on this, not
    # email, so a user keeps their org even if their email later changes.
    supabase_user_id = Column(Text, nullable=False, unique=True)
    email = Column(Text, nullable=False)
    # Nullable: a user is authenticated before they pick/join an org in onboarding.
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"))
    name = Column(Text)
    phone = Column(Text)
    profile_completed = Column(Boolean, nullable=False, server_default="false")
    onboarded_at = Column(Text)
    created_at = Column(Text, nullable=False)


class ChatRateEvent(Base):
    __tablename__ = "chat_rate_events"
    __table_args__ = (Index("idx_rate_user_time", "supabase_user_id", "created_at"),)

    id = Column(Integer, primary_key=True)
    # Keyed on the JWT `sub`, not app_users.id — the limiter resolves identity from
    # the verified token directly, before any onboarding/org lookup.
    supabase_user_id = Column(Text, nullable=False)
    # ISO-8601 UTC with Z suffix (sortable lexicographically); one row per accepted
    # chat message. Pruned to the active window on each check.
    created_at = Column(Text, nullable=False)


class OrgInviteCode(Base):
    __tablename__ = "org_invite_codes"

    id = Column(Integer, primary_key=True)
    # Stored lowercased; redemption matches case-insensitively. Grants membership
    # to exactly one org — the secret that lets a non-company email join a team.
    code = Column(Text, nullable=False, unique=True)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    max_uses = Column(Integer)
    used_count = Column(Integer, nullable=False, server_default="0")
    expires_at = Column(Text)
    created_at = Column(Text, nullable=False)


class Asset(Base):
    __tablename__ = "assets"

    id = Column(Integer, primary_key=True)
    # org_id is NOT NULL in the DB after backfill; nullable here only so existing
    # in-memory construction paths don't need to set it before the column lands.
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"))
    reporting_mark = Column(Text, nullable=False)
    road_number = Column(Text, nullable=False)
    unit_model = Column(Text, nullable=False)
    in_service_date = Column(Text)
    last_92_day_at = Column(Text)
    last_368_day_at = Column(Text)
    last_1104_day_at = Column(Text)
    out_of_service = Column(Boolean, nullable=False, server_default="false")
    oos_since = Column(Text)


class OosPeriod(Base):
    __tablename__ = "oos_periods"
    __table_args__ = (Index("idx_oos_periods_asset", "org_id", "asset_id"),)

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    asset_id = Column(Integer, ForeignKey("assets.id", ondelete="CASCADE"), nullable=False)
    started_at = Column(Text, nullable=False)  # YYYY-MM-DD, matches oos_since
    ended_at = Column(Text)  # YYYY-MM-DD, NULL while ongoing


class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"))
    asset_id = Column(Integer, ForeignKey("assets.id", ondelete="CASCADE"))
    title = Column(Text)
    short_id = Column(Text, unique=True)
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
    ticket_id = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"))
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
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"))
    # part_number is unique per org, not globally — two railroads may stock the
    # same OEM part number. Enforced by a partial unique index in migrate.py.
    part_number = Column(Text, nullable=False)
    name = Column(Text, nullable=False)
    description = Column(Text)
    # Nullable: inventory ingested from an external ledger (e.g. NetSuite) may have
    # no locomotive mapping ([]) and may be stocked at many warehouses rather than
    # one bin — neither field is guaranteed for such parts.
    compatible_units = Column(JSONB)
    bin_location = Column(Text)
    qty_on_hand = Column(Integer, nullable=False)
    supplier = Column(Text)
    lead_time_days = Column(Integer)
    alternate_part_numbers = Column(JSONB)
    last_used_at = Column(Text)
    # External-ledger fields (NetSuite stock ledger). avg_cost/on_hand_value are
    # item-level; locations is the per-warehouse breakdown [{location, qty,
    # avg_cost, value}].
    avg_cost = Column(Numeric)
    on_hand_value = Column(Numeric)
    locations = Column(JSONB)
    department = Column(Text)
    subsidiary = Column(Text)
    inv_class = Column(Text)


class TicketPart(Base):
    __tablename__ = "ticket_parts"

    id = Column(Integer, primary_key=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"))
    part_id = Column(Integer, ForeignKey("parts.id", ondelete="CASCADE"))
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
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"))
    # null unit_model = shared across all models; null asset_id = not unit-specific
    unit_model = Column(Text)
    # Optional multi-model tag (railio-ingest only): a manual shared by several
    # models. NULL/empty ⇒ fall back to scalar unit_model. The DDL is owned by
    # the ingest migration; declared here to keep the ORM honest.
    unit_models = Column(ARRAY(Text))
    asset_id = Column(Integer, ForeignKey("assets.id", ondelete="CASCADE"))


class TribalCapture(Base):
    __tablename__ = "tribal_capture"

    id = Column(Integer, primary_key=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"))
    author = Column(Text)
    text = Column(Text, nullable=False)
    captured_at = Column(Text, nullable=False)
    promoted_chunk_id = Column(Integer)


class HistoricalRecord(Base):
    __tablename__ = "historical_records"

    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"))
    asset_id = Column(Integer, ForeignKey("assets.id", ondelete="CASCADE"))
    reported_date = Column(Text)
    completed_date = Column(Text)
    record_type = Column(Text)
    # repairs: list[str]; tests: list[{date, name}]
    repairs = Column(JSONB)
    tests = Column(JSONB)
    technician = Column(Text)
    notes = Column(Text)
    created_at = Column(Text, nullable=False)


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
