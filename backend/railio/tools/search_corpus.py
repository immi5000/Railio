"""pgvector KNN over corpus_chunks."""

from __future__ import annotations

from typing import Any, Literal, Optional

from sqlalchemy import text

from ..corpus_figures import figures_supported, parse_figures
from ..db import session_scope
from ..embeddings import embed

DocClassFilter = Literal["manual", "tribal_knowledge", "any"]


async def search_corpus(
    query: str,
    k: int = 6,
    doc_class_filter: DocClassFilter = "any",
    *,
    org_id: Optional[int] = None,
    unit_model: Optional[str] = None,
    asset_id: Optional[int] = None,
) -> dict[str, Any]:
    """KNN over the corpus.

    Scope (org_id / unit_model / asset_id) is injected by the runtime from the
    ticket — never by the model. A chunk is in scope when its org_id matches the
    ticket's org OR is null (shared, e.g. CFR visible to all tenants), AND its
    unit_model matches OR is null, AND its asset_id matches OR is null. When a
    scope value is None that filter is omitted (back-compat).
    """
    k = max(1, min(20, int(k)))
    vecs = await embed([query], "query")
    if not vecs:
        return {"query": query, "chunks": []}
    vec_literal = "[" + ",".join(str(x) for x in vecs[0]) + "]"

    where = ["embedding IS NOT NULL"]
    params: dict[str, Any] = {"vec": vec_literal, "k": k}
    if doc_class_filter != "any":
        where.append("doc_class = :cls")
        params["cls"] = doc_class_filter
    if org_id is not None:
        where.append("(org_id = :org_id OR org_id IS NULL)")
        params["org_id"] = org_id
    if unit_model is not None:
        where.append("(unit_model = :unit_model OR unit_model IS NULL)")
        params["unit_model"] = unit_model
    if asset_id is not None:
        where.append("(asset_id = :asset_id OR asset_id IS NULL)")
        params["asset_id"] = asset_id

    rows: list[Any] = []
    has_figs = False
    try:
        async with session_scope() as session:
            has_figs = await figures_supported(session)
            fig_col = ", figures" if has_figs else ""
            sql = text(
                f"""
                SELECT id, doc_class, doc_id, doc_title, source_label, page, text,
                       (embedding <-> CAST(:vec AS vector)) AS distance{fig_col}
                FROM corpus_chunks
                WHERE {' AND '.join(where)}
                ORDER BY embedding <-> CAST(:vec AS vector)
                LIMIT :k
                """
            )
            rows = (await session.execute(sql, params)).mappings().all()
    except Exception as e:
        print(f"search_corpus query failed: {e}")
        rows = []

    def _fig_meta(r: Any) -> list[dict[str, Any]]:
        # Lightweight per-figure metadata only — enough for the model to pick a
        # figure via show_figure(chunk_id, figure_index) without flooding it with
        # paths/bboxes/callouts.
        if not has_figs:
            return []
        out = []
        for i, f in enumerate(parse_figures(r.get("figures"))):
            out.append(
                {
                    "index": i,
                    "figure_label": f.get("figure_label"),
                    "caption": f.get("caption", ""),
                }
            )
        return out

    return {
        "query": query,
        "chunks": [
            {
                "id": r["id"],
                "doc_class": r["doc_class"],
                "doc_id": r["doc_id"],
                "doc_title": r["doc_title"],
                "source_label": r["source_label"],
                "page": r["page"],
                "text": r["text"],
                "distance": float(r["distance"]),
                "figures": _fig_meta(r),
            }
            for r in rows
        ],
    }
