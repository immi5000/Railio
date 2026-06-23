"""Direct prod-DB access for the ingestion tool.

Mirrors the backend's async-URL handling and the pgvector insert pattern
(CAST(:vec AS vector); statement_cache_size=0 for the Supabase pooler). This is
the SOLE writer for the model-level manual data path. All schema it needs is
created here (additive only — never drops, never touches the hash chain or the
assets table).
"""

from __future__ import annotations

import re
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .config import get_settings

_engine = None
_maker: Optional[async_sessionmaker[AsyncSession]] = None


def _to_async_url(raw: str) -> str:
    url = re.sub(r"^postgres://", "postgresql://", raw)
    if url.startswith("postgresql+"):
        return url
    return url.replace("postgresql://", "postgresql+asyncpg://", 1)


def _get_maker() -> async_sessionmaker[AsyncSession]:
    global _engine, _maker
    if _maker is not None:
        return _maker
    raw = get_settings().require_db()
    # Supabase transaction pooler (6543) requires statement_cache_size=0.
    _engine = create_async_engine(
        _to_async_url(raw),
        connect_args={"statement_cache_size": 0},
        pool_pre_ping=True,
    )
    _maker = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)
    return _maker


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    async with _get_maker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def close_engine() -> None:
    global _engine, _maker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _maker = None


# --- Schema (idempotent, additive only) ---

_MIGRATION = """
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS models (
    id          SERIAL PRIMARY KEY,
    oem         TEXT,
    model_code  TEXT NOT NULL UNIQUE,
    created_at  TEXT
);

CREATE TABLE IF NOT EXISTS documents (
    id          SERIAL PRIMARY KEY,
    org_id      INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    model_id    INTEGER REFERENCES models(id) ON DELETE CASCADE,
    doc_id      TEXT NOT NULL,
    doc_title   TEXT NOT NULL,
    doc_class   TEXT NOT NULL,
    unit_model  TEXT,
    page_count  INTEGER,
    created_at  TEXT
);

-- Storage key of the uploaded source PDF (manuals/<doc_id>/source.pdf) so the
-- website can deep-link to the original document at a page.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS pdf_path TEXT;

-- A manual is shared-by-model (org_id NULL); identity is (model_id, doc_id).
-- Use a NULL-safe unique index so re-runs upsert cleanly even with org_id NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_model_doc
    ON documents (model_id, doc_id);

ALTER TABLE corpus_chunks ADD COLUMN IF NOT EXISTS document_id INTEGER
    REFERENCES documents(id) ON DELETE CASCADE;
ALTER TABLE corpus_chunks ADD COLUMN IF NOT EXISTS model_id INTEGER
    REFERENCES models(id) ON DELETE CASCADE;
ALTER TABLE corpus_chunks ADD COLUMN IF NOT EXISTS figures JSONB;
-- True 1-based PDF page index (distinct from the printed `page`); the #page=N
-- deep-link target for a chunk.
ALTER TABLE corpus_chunks ADD COLUMN IF NOT EXISTS pdf_page INTEGER;

-- Multi-model tagging: a manual shared by several models (e.g. the 645E engine
-- manual on both GP38-2 and SD38-2). NULL/empty ⇒ fall back to the scalar
-- unit_model (CFR NULL = shared-all; single-model = exact). Additive, no migration.
ALTER TABLE corpus_chunks ADD COLUMN IF NOT EXISTS unit_models TEXT[];
ALTER TABLE documents ADD COLUMN IF NOT EXISTS unit_models TEXT[];

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_unit_models
    ON corpus_chunks USING gin (unit_models);

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_text_trgm
    ON corpus_chunks USING gin (text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_document
    ON corpus_chunks (document_id);
"""


async def run_migration() -> None:
    """Create models/documents tables + corpus_chunks additions + trigram index.
    Safe to run repeatedly. Splits on ';' because asyncpg won't run a multi-
    statement string in one execute(). Line comments are stripped first so a ';'
    inside a comment doesn't fracture the statement that follows it."""
    sql = "\n".join(
        line for line in _MIGRATION.splitlines() if not line.lstrip().startswith("--")
    )
    async with session_scope() as s:
        for stmt in sql.split(";"):
            if stmt.strip():
                await s.execute(text(stmt))


# --- Model / document resolution ---


async def resolve_model(model_code: str, oem: Optional[str], now: str) -> int:
    """Return models.id for model_code, creating the row if absent."""
    async with session_scope() as s:
        row = (
            await s.execute(
                text("SELECT id FROM models WHERE model_code = :mc"),
                {"mc": model_code},
            )
        ).first()
        if row:
            return int(row[0])
        new_id = (
            await s.execute(
                text(
                    "INSERT INTO models (oem, model_code, created_at) "
                    "VALUES (:oem, :mc, :now) RETURNING id"
                ),
                {"oem": oem, "mc": model_code, "now": now},
            )
        ).scalar_one()
        return int(new_id)


async def model_exists(model_code: str) -> bool:
    async with session_scope() as s:
        row = (
            await s.execute(
                text("SELECT 1 FROM models WHERE model_code = :mc"),
                {"mc": model_code},
            )
        ).first()
        return row is not None


async def upsert_document(
    *,
    model_id: int,
    doc_id: str,
    doc_title: str,
    doc_class: str,
    unit_model: str,
    page_count: int,
    now: str,
    pdf_path: Optional[str] = None,
    unit_models: Optional[list[str]] = None,
) -> int:
    """Upsert the documents row for (model_id, doc_id); return its id."""
    async with session_scope() as s:
        new_id = (
            await s.execute(
                text(
                    """
                    INSERT INTO documents
                        (org_id, model_id, doc_id, doc_title, doc_class,
                         unit_model, unit_models, page_count, pdf_path, created_at)
                    VALUES
                        (NULL, :model_id, :doc_id, :doc_title, :doc_class,
                         :unit_model, :unit_models, :page_count, :pdf_path, :now)
                    ON CONFLICT (model_id, doc_id) DO UPDATE SET
                        doc_title = EXCLUDED.doc_title,
                        doc_class = EXCLUDED.doc_class,
                        unit_model = EXCLUDED.unit_model,
                        unit_models = EXCLUDED.unit_models,
                        page_count = EXCLUDED.page_count,
                        pdf_path = EXCLUDED.pdf_path
                    RETURNING id
                    """
                ),
                {
                    "model_id": model_id,
                    "doc_id": doc_id,
                    "doc_title": doc_title,
                    "doc_class": doc_class,
                    "unit_model": unit_model,
                    "unit_models": unit_models,
                    "page_count": page_count,
                    "pdf_path": pdf_path,
                    "now": now,
                },
            )
        ).scalar_one()
        return int(new_id)


async def get_document_by_doc_id(doc_id: str) -> Optional[dict[str, Any]]:
    """Fetch the documents row for a doc_id (id + title), or None if not ingested."""
    async with session_scope() as s:
        row = (
            await s.execute(
                text("SELECT id, doc_title, pdf_path FROM documents WHERE doc_id = :d"),
                {"d": doc_id},
            )
        ).mappings().first()
        return dict(row) if row else None


async def set_document_pdf_path(document_id: int, pdf_path: str) -> None:
    async with session_scope() as s:
        await s.execute(
            text("UPDATE documents SET pdf_path = :p WHERE id = :id"),
            {"p": pdf_path, "id": document_id},
        )


async def get_document_chunk_ids(document_id: int) -> list[int]:
    """Chunk ids for a document in insertion order (= the order ingest rendered
    pages), so a backfill can map them positionally to rendered book-pages."""
    async with session_scope() as s:
        rows = (
            await s.execute(
                text(
                    "SELECT id FROM corpus_chunks WHERE document_id = :d ORDER BY id"
                ),
                {"d": document_id},
            )
        ).scalars().all()
        return [int(x) for x in rows]


async def set_chunk_pdf_pages(pairs: list[tuple[int, int]]) -> int:
    """Set pdf_page per chunk id. Returns rows updated."""
    updated = 0
    async with session_scope() as s:
        for chunk_id, pdf_page in pairs:
            res = await s.execute(
                text("UPDATE corpus_chunks SET pdf_page = :n WHERE id = :id"),
                {"n": pdf_page, "id": chunk_id},
            )
            updated += res.rowcount or 0
    return updated


async def backfill_chunk_pdf_pages(
    document_id: int, mapping: dict[str, int]
) -> int:
    """Set pdf_page on existing chunks (id-preserving) by matching source_label.
    Returns the number of chunk rows updated."""
    updated = 0
    async with session_scope() as s:
        for label, pdf_page in mapping.items():
            res = await s.execute(
                text(
                    "UPDATE corpus_chunks SET pdf_page = :n "
                    "WHERE document_id = :doc AND source_label = :label"
                ),
                {"n": pdf_page, "doc": document_id, "label": label},
            )
            updated += res.rowcount or 0
    return updated


async def delete_document_chunks(document_id: int) -> int:
    """Scoped delete: remove this document's chunks so a re-run replaces (not
    duplicates) them. Never touches other docs/models/orgs."""
    async with session_scope() as s:
        res = await s.execute(
            text("DELETE FROM corpus_chunks WHERE document_id = :doc"),
            {"doc": document_id},
        )
        return res.rowcount or 0


async def insert_chunks(rows: list[dict[str, Any]]) -> int:
    """Bulk-insert chunk rows. Each row must include a pre-built `embedding`
    text literal '[v1,v2,…]' (asyncpg won't convert a Python list to vector)
    and a `figures` value (JSON string or None)."""
    if not rows:
        return 0
    async with session_scope() as s:
        for r in rows:
            await s.execute(
                text(
                    """
                    INSERT INTO corpus_chunks
                        (doc_class, doc_id, doc_title, source_label, page, pdf_page,
                         text, org_id, unit_model, unit_models, asset_id, embedding,
                         document_id, model_id, figures)
                    VALUES
                        (:doc_class, :doc_id, :doc_title, :source_label, :page, :pdf_page,
                         :text, NULL, :unit_model, :unit_models, NULL, CAST(:embedding AS vector),
                         :document_id, :model_id, CAST(:figures AS jsonb))
                    """
                ),
                r,
            )
    return len(rows)
