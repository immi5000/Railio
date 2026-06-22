"""Load a single corpus figure for inline display in the chat."""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import text

from ..corpus_figures import figures_supported, parse_figures
from ..db import session_scope


async def show_figure(
    chunk_id: int,
    figure_index: int = 0,
    *,
    org_id: Optional[int] = None,
) -> dict[str, Any]:
    """Resolve one figure on a chunk for inline rendering.

    The model picks chunk_id freely, so this independently enforces the tenant
    boundary: a chunk is reachable only when its org_id matches the ticket's org
    OR is null (shared, e.g. CFR). org_id is injected by the runtime, never by
    the model.
    """
    where = ["id = :id"]
    params: dict[str, Any] = {"id": int(chunk_id)}
    if org_id is not None:
        where.append("(org_id = :org OR org_id IS NULL)")
        params["org"] = org_id

    async with session_scope() as session:
        if not await figures_supported(session):
            return {"ok": False, "error": "no figures in this corpus"}
        sql = text(
            f"SELECT id, figures FROM corpus_chunks WHERE {' AND '.join(where)}"
        )
        row = (await session.execute(sql, params)).mappings().first()

    if row is None:
        return {"ok": False, "error": "chunk not found"}

    figures = parse_figures(row.get("figures"))
    idx = int(figure_index)
    if idx < 0 or idx >= len(figures):
        return {"ok": False, "error": "figure_index out of range"}

    f = figures[idx]
    return {
        "ok": True,
        "chunk_id": int(chunk_id),
        "figure": {
            "path": f.get("path"),
            "caption": f.get("caption", ""),
            "page": f.get("page"),
            "figure_label": f.get("figure_label"),
            "callouts": f.get("callouts") or [],
        },
    }
