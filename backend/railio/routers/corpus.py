"""Corpus library + per-chunk lookup."""

from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import text

from ..contract import Organization
from ..corpus_links import resolve_document_url, resolve_source_url
from ..db import session_scope
from ..org_context import get_current_org

router = APIRouter()

# `unit_model` is core schema; `figures`, `pdf_page`, `document_id` and the
# `documents` table are added by the offline manual-ingest tool and may be absent
# on a DB that never ingested an OEM manual. Detect each once so queries degrade
# gracefully (CFR-only deep links still work) instead of erroring.
_col_cache: dict[str, bool] = {}


async def _has_column(session: Any, table: str, column: str) -> bool:
    key = f"{table}.{column}"
    if key not in _col_cache:
        row = (
            await session.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = :t AND column_name = :c"
                ),
                {"t": table, "c": column},
            )
        ).first()
        _col_cache[key] = row is not None
    return _col_cache[key]


async def _figures_supported(session: Any) -> bool:
    return await _has_column(session, "corpus_chunks", "figures")


async def _pdf_supported(session: Any) -> bool:
    """True when the offline-ingest manual columns exist (documents.pdf_path +
    corpus_chunks.document_id/pdf_page), so we can deep-link OEM manual PDFs."""
    return (
        await _has_column(session, "documents", "pdf_path")
        and await _has_column(session, "corpus_chunks", "document_id")
        and await _has_column(session, "corpus_chunks", "pdf_page")
    )


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
    doc_id: Optional[str] = None,
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
    if doc_id:
        where.append("doc_id = :doc_id")
        params["doc_id"] = doc_id
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


@router.get("/models")
async def list_models(
    org: Organization = Depends(get_current_org),
) -> JSONResponse:
    """Locomotive models that have ingested knowledge, for the add-asset dropdown.

    Source of truth is the offline-ingest `models` table when present; otherwise
    we derive the list from the distinct `unit_model`s on manual chunks the org
    can see. Each row carries a chunk count so the UI can show coverage and never
    let a dispatcher type a model string that has no manual behind it.
    """
    async with session_scope() as session:
        has_models = (
            await session.execute(
                text(
                    "SELECT 1 FROM information_schema.tables "
                    "WHERE table_name = 'models'"
                )
            )
        ).first() is not None

        if has_models:
            # A multi-model manual's chunks carry the primary model_id but tag
            # every model in unit_models[], so count both ways when that column
            # exists — else the shared manual would only show under its primary.
            if await _has_column(session, "corpus_chunks", "unit_models"):
                join_on = (
                    "c.model_id = m.id "
                    "OR (c.unit_models IS NOT NULL AND m.model_code = ANY(c.unit_models))"
                )
            else:
                join_on = "c.model_id = m.id"
            rows = (
                await session.execute(
                    text(
                        f"""
                        SELECT m.model_code, m.oem,
                               COUNT(c.id) FILTER (
                                 WHERE c.org_id = :org OR c.org_id IS NULL
                               ) AS chunk_count
                        FROM models m
                        LEFT JOIN corpus_chunks c ON {join_on}
                        GROUP BY m.model_code, m.oem
                        ORDER BY m.model_code
                        """
                    ),
                    {"org": org.id},
                )
            ).mappings().all()
        else:
            rows = (
                await session.execute(
                    text(
                        """
                        SELECT unit_model AS model_code, NULL AS oem,
                               COUNT(*) AS chunk_count
                        FROM corpus_chunks
                        WHERE doc_class = 'manual' AND unit_model IS NOT NULL
                          AND (org_id = :org OR org_id IS NULL)
                        GROUP BY unit_model
                        ORDER BY unit_model
                        """
                    ),
                    {"org": org.id},
                )
            ).mappings().all()

    models = [
        {
            "model_code": r["model_code"],
            "oem": r["oem"],
            "chunk_count": int(r["chunk_count"] or 0),
        }
        for r in rows
    ]
    return JSONResponse({"models": models})


@router.get("/chunks/{chunk_id}")
async def get_chunk(
    chunk_id: int, org: Organization = Depends(get_current_org)
) -> JSONResponse:
    async with session_scope() as session:
        fig_col = ", c.figures" if await _figures_supported(session) else ""
        pdf = await _pdf_supported(session)
        pdf_select = ", c.pdf_page, d.pdf_path" if pdf else ""
        pdf_join = (
            "LEFT JOIN documents d ON d.id = c.document_id" if pdf else ""
        )
        row = (
            await session.execute(
                text(
                    f"""
                    SELECT c.id, c.doc_class, c.doc_id, c.doc_title,
                           c.source_label, c.page, c.text, c.unit_model
                           {fig_col}{pdf_select}
                    FROM corpus_chunks c {pdf_join}
                    WHERE c.id = :id AND (c.org_id = :org OR c.org_id IS NULL)
                    """
                ),
                {"id": chunk_id, "org": org.id},
            )
        ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    d = _normalize(dict(row))
    d["source_url"] = resolve_source_url(d)
    # pdf_path is an internal storage key; don't leak it to the client.
    d.pop("pdf_path", None)
    return JSONResponse(d)


@router.get("/documents")
async def list_documents(
    org: Organization = Depends(get_current_org),
) -> JSONResponse:
    """The Knowledge library, document-first: one row per source document
    (CFR part, OEM manual, tribal note set) with a count and an openable link.
    Derived by grouping chunks so it works even without the offline `documents`
    table; LEFT JOIN documents only to enrich OEM manuals with their PDF."""
    async with session_scope() as session:
        pdf = await _pdf_supported(session)
        pdf_select = ", MAX(d.pdf_path) AS pdf_path, MAX(d.page_count) AS page_count"
        pdf_join = (
            "LEFT JOIN documents d ON d.id = c.document_id" if pdf else ""
        )
        if not pdf:
            pdf_select = ", NULL AS pdf_path, NULL AS page_count"
        # A manual tagged to several models should appear once per model in the
        # library. CROSS JOIN LATERAL unnest(unit_models[]) (falling back to the
        # scalar when no array) yields an "effective model" we group on, so e.g.
        # the shared 645E manual lists under both GP38-2 and SD38-2.
        if await _has_column(session, "corpus_chunks", "unit_models"):
            model_join = (
                " CROSS JOIN LATERAL unnest("
                "COALESCE(NULLIF(c.unit_models, '{}'), ARRAY[c.unit_model])"
                ") AS um(unit_model)"
            )
            model_col = "um.unit_model"
        else:
            model_join = ""
            model_col = "c.unit_model"
        rows = (
            await session.execute(
                text(
                    f"""
                    SELECT c.doc_class, c.doc_id, c.doc_title,
                           {model_col} AS unit_model,
                           COUNT(*) AS chunk_count{pdf_select}
                    FROM corpus_chunks c {pdf_join}{model_join}
                    WHERE (c.org_id = :org OR c.org_id IS NULL)
                    GROUP BY c.doc_class, c.doc_id, c.doc_title, {model_col}
                    ORDER BY c.doc_class, {model_col} NULLS FIRST, c.doc_title
                    """
                ),
                {"org": org.id},
            )
        ).mappings().all()

    docs = []
    for r in rows:
        d = dict(r)
        d["chunk_count"] = int(d["chunk_count"] or 0)
        d["page_count"] = int(d["page_count"]) if d.get("page_count") else None
        d["source_url"] = resolve_document_url(d)
        d.pop("pdf_path", None)
        docs.append(d)
    return JSONResponse({"documents": docs})
