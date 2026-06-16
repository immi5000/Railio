"""Corpus library + per-chunk lookup."""

from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import text

from ..contract import Organization
from ..db import session_scope
from ..org_context import get_current_org

router = APIRouter()

# `unit_model` is core schema; `figures` is added by the offline manual-ingest
# tool and may be absent on a DB that has never ingested an OEM manual. Detect it
# once so the library query degrades gracefully instead of erroring.
_has_figures: Optional[bool] = None


async def _figures_supported(session: Any) -> bool:
    global _has_figures
    if _has_figures is None:
        row = (
            await session.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = 'corpus_chunks' AND column_name = 'figures'"
                )
            )
        ).first()
        _has_figures = row is not None
    return _has_figures


def _normalize(row: dict[str, Any]) -> dict[str, Any]:
    figs = row.get("figures")
    if isinstance(figs, str):
        try:
            figs = json.loads(figs)
        except (ValueError, TypeError):
            figs = None
    row["figures"] = figs or []
    return row


@router.get("/chunks")
async def list_chunks(
    doc_class: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 500,
    org: Organization = Depends(get_current_org),
) -> JSONResponse:
    limit = max(1, min(2000, int(limit or 500)))
    like = f"%{q.strip()}%" if (q and q.strip()) else None

    # A tenant's library shows shared chunks (org_id IS NULL, e.g. CFR) plus only
    # its own org-private chunks — never another org's.
    where = ["(org_id = :org OR org_id IS NULL)"]
    params: dict[str, Any] = {"org": org.id, "lim": limit}
    if doc_class in ("manual", "tribal_knowledge"):
        where.append("doc_class = :cls")
        params["cls"] = doc_class
    if like:
        where.append(
            "(text ILIKE :like OR doc_title ILIKE :like OR source_label ILIKE :like)"
        )
        params["like"] = like

    async with session_scope() as session:
        fig_col = ", figures" if await _figures_supported(session) else ""
        sql = text(
            f"""
            SELECT id, doc_class, doc_id, doc_title, source_label, page, text,
                   unit_model{fig_col}
            FROM corpus_chunks
            WHERE {' AND '.join(where)}
            ORDER BY doc_class, doc_title, COALESCE(page, 0), id
            LIMIT :lim
            """
        )
        rows = (await session.execute(sql, params)).mappings().all()
    chunks = [_normalize(dict(r)) for r in rows]
    return JSONResponse({"chunks": chunks})


@router.get("/chunks/{chunk_id}")
async def get_chunk(
    chunk_id: int, org: Organization = Depends(get_current_org)
) -> JSONResponse:
    async with session_scope() as session:
        fig_col = ", figures" if await _figures_supported(session) else ""
        row = (
            await session.execute(
                text(
                    f"""
                    SELECT id, doc_class, doc_id, doc_title, source_label, page,
                           text, unit_model{fig_col}
                    FROM corpus_chunks
                    WHERE id = :id AND (org_id = :org OR org_id IS NULL)
                    """
                ),
                {"id": chunk_id, "org": org.id},
            )
        ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return JSONResponse(_normalize(dict(row)))
