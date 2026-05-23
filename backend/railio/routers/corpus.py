"""Corpus library + per-chunk lookup."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import text

from ..db import session_scope

router = APIRouter()


@router.get("/chunks")
async def list_chunks(
    doc_class: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 500,
) -> JSONResponse:
    limit = max(1, min(2000, int(limit or 500)))
    is_class = doc_class in ("manual", "tribal_knowledge")
    like = f"%{q.strip()}%" if (q and q.strip()) else None

    async with session_scope() as session:
        if is_class and like:
            rows = (
                await session.execute(
                    text(
                        """
                        SELECT id, doc_class, doc_id, doc_title, source_label, page, text
                        FROM corpus_chunks
                        WHERE doc_class = :cls
                          AND (text ILIKE :like OR doc_title ILIKE :like OR source_label ILIKE :like)
                        ORDER BY doc_class, doc_title, COALESCE(page, 0), id
                        LIMIT :lim
                        """
                    ),
                    {"cls": doc_class, "like": like, "lim": limit},
                )
            ).mappings().all()
        elif is_class:
            rows = (
                await session.execute(
                    text(
                        """
                        SELECT id, doc_class, doc_id, doc_title, source_label, page, text
                        FROM corpus_chunks
                        WHERE doc_class = :cls
                        ORDER BY doc_class, doc_title, COALESCE(page, 0), id
                        LIMIT :lim
                        """
                    ),
                    {"cls": doc_class, "lim": limit},
                )
            ).mappings().all()
        elif like:
            rows = (
                await session.execute(
                    text(
                        """
                        SELECT id, doc_class, doc_id, doc_title, source_label, page, text
                        FROM corpus_chunks
                        WHERE text ILIKE :like OR doc_title ILIKE :like OR source_label ILIKE :like
                        ORDER BY doc_class, doc_title, COALESCE(page, 0), id
                        LIMIT :lim
                        """
                    ),
                    {"like": like, "lim": limit},
                )
            ).mappings().all()
        else:
            rows = (
                await session.execute(
                    text(
                        """
                        SELECT id, doc_class, doc_id, doc_title, source_label, page, text
                        FROM corpus_chunks
                        ORDER BY doc_class, doc_title, COALESCE(page, 0), id
                        LIMIT :lim
                        """
                    ),
                    {"lim": limit},
                )
            ).mappings().all()
    chunks: list[dict[str, Any]] = [dict(r) for r in rows]
    return JSONResponse({"chunks": chunks})


@router.get("/chunks/{chunk_id}")
async def get_chunk(chunk_id: int) -> JSONResponse:
    async with session_scope() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT id, doc_class, doc_id, doc_title, source_label, page, text
                    FROM corpus_chunks WHERE id = :id
                    """
                ),
                {"id": chunk_id},
            )
        ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return JSONResponse(dict(row))
