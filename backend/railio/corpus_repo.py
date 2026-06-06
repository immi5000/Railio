"""Runtime corpus writes — embed a single doc and insert it into corpus_chunks.

Reused by asset document attachment (dispatcher uploads a manual / history) and
by the close-the-loop repair-history write-back. Mirrors the batch INSERT in
scripts/corpus_build.py but for one chunk at request time.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import text

from .db import session_scope
from .embeddings import embed


async def insert_corpus_chunk(
    *,
    doc_class: str,
    doc_id: str,
    doc_title: str,
    source_label: str,
    text_body: str,
    unit_model: Optional[str] = None,
    asset_id: Optional[int] = None,
    page: Optional[int] = None,
) -> Optional[int]:
    """Embed text_body and insert one corpus chunk. Returns the new chunk id.

    Returns None if embedding fails (caller decides whether that's fatal). The
    pgvector literal must be passed as a "[v1,v2,…]" text cast — asyncpg won't
    convert a Python list to the vector type.
    """
    vecs = await embed([text_body], "document")
    if not vecs:
        return None
    vec_literal = "[" + ",".join(str(x) for x in vecs[0]) + "]"

    async with session_scope() as session:
        row = (
            await session.execute(
                text(
                    """
                    INSERT INTO corpus_chunks
                        (doc_class, doc_id, doc_title, source_label, page, text,
                         unit_model, asset_id, embedding)
                    VALUES
                        (:doc_class, :doc_id, :doc_title, :source_label, :page, :text,
                         :unit_model, :asset_id, CAST(:embedding AS vector))
                    RETURNING id
                    """
                ),
                {
                    "doc_class": doc_class,
                    "doc_id": doc_id,
                    "doc_title": doc_title,
                    "source_label": source_label,
                    "page": page,
                    "text": text_body,
                    "unit_model": unit_model,
                    "asset_id": asset_id,
                    "embedding": vec_literal,
                },
            )
        ).first()
    return row[0] if row else None
