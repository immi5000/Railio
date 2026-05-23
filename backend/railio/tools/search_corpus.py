"""pgvector KNN over corpus_chunks."""

from __future__ import annotations

from typing import Any, Literal

from sqlalchemy import text

from ..db import session_scope
from ..embeddings import embed

DocClassFilter = Literal["manual", "tribal_knowledge", "any"]


async def search_corpus(
    query: str,
    k: int = 6,
    doc_class_filter: DocClassFilter = "any",
) -> dict[str, Any]:
    k = max(1, min(20, int(k)))
    vecs = await embed([query], "query")
    if not vecs:
        return {"query": query, "chunks": []}
    vec_literal = "[" + ",".join(str(x) for x in vecs[0]) + "]"

    rows: list[Any] = []
    try:
        async with session_scope() as session:
            if doc_class_filter == "any":
                sql = text(
                    """
                    SELECT id, doc_class, doc_id, doc_title, source_label, page, text,
                           (embedding <-> CAST(:vec AS vector)) AS distance
                    FROM corpus_chunks
                    WHERE embedding IS NOT NULL
                    ORDER BY embedding <-> CAST(:vec AS vector)
                    LIMIT :k
                    """
                )
                rows = (
                    await session.execute(sql, {"vec": vec_literal, "k": k})
                ).mappings().all()
            else:
                sql = text(
                    """
                    SELECT id, doc_class, doc_id, doc_title, source_label, page, text,
                           (embedding <-> CAST(:vec AS vector)) AS distance
                    FROM corpus_chunks
                    WHERE embedding IS NOT NULL AND doc_class = :cls
                    ORDER BY embedding <-> CAST(:vec AS vector)
                    LIMIT :k
                    """
                )
                rows = (
                    await session.execute(
                        sql, {"vec": vec_literal, "k": k, "cls": doc_class_filter}
                    )
                ).mappings().all()
    except Exception as e:
        print(f"search_corpus query failed: {e}")
        rows = []

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
            }
            for r in rows
        ],
    }
