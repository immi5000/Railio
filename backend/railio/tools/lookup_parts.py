"""Parts lookup with token-based ranking."""

from __future__ import annotations

import re
from typing import Any, Optional

from sqlalchemy import text

from ..db import session_scope

_STOPWORDS = {
    "a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "with",
    "is", "are", "be", "this", "that", "these", "those", "it", "its",
    "part", "parts", "component", "components", "piece", "pieces",
    "need", "needed", "looking", "find",
}

_TOKEN_SPLIT = re.compile(r"[^a-z0-9-]+")


def _tokenize(q: str) -> list[str]:
    seen: list[str] = []
    out: list[str] = []
    for t in _TOKEN_SPLIT.split(q.lower()):
        if len(t) >= 2 and t not in _STOPWORDS and t not in seen:
            seen.append(t)
            out.append(t)
    return out


async def lookup_parts(
    unit_model: str, query: str, *, org_id: Optional[int] = None
) -> dict[str, Any]:
    tokens = _tokenize(query)
    if not tokens:
        cleaned = query.strip().lower()
        tokens = [cleaned] if cleaned else []
    if not tokens:
        return {"matches": []}
    like_args = [f"%{t}%" for t in tokens]

    # org_id is injected by the runtime so a tenant only ever sees its own
    # inventory — parts are never shared across organizations.
    org_clause = "AND p.org_id = :org_id" if org_id is not None else ""
    sql = text(
        f"""
        SELECT p.*,
          (
            SELECT COUNT(*) FROM unnest(CAST(:terms AS text[])) AS term
            WHERE p.name ILIKE term OR p.description ILIKE term OR p.part_number ILIKE term
          ) AS hit_count
        FROM parts p
        WHERE (
            p.compatible_units IS NULL
            OR p.compatible_units = '[]'::jsonb
            OR p.compatible_units ? :unit
          )
          {org_clause}
          AND EXISTS (
            SELECT 1 FROM unnest(CAST(:terms AS text[])) AS term
            WHERE p.name ILIKE term OR p.description ILIKE term OR p.part_number ILIKE term
          )
        ORDER BY hit_count DESC, p.qty_on_hand DESC, p.name ASC
        LIMIT 10
        """
    )
    sql_params: dict[str, Any] = {"terms": like_args, "unit": unit_model}
    if org_id is not None:
        sql_params["org_id"] = org_id
    async with session_scope() as session:
        rows = (await session.execute(sql, sql_params)).mappings().all()

    return {
        "matches": [
            {
                "id": r["id"],
                "part_number": r["part_number"],
                "name": r["name"],
                "description": r["description"],
                "compatible_units": r["compatible_units"] or [],
                "bin_location": r["bin_location"],
                "qty_on_hand": r["qty_on_hand"],
                "supplier": r["supplier"],
                "lead_time_days": r["lead_time_days"],
                "alternate_part_numbers": r["alternate_part_numbers"] or [],
                "last_used_at": r["last_used_at"],
            }
            for r in rows
        ]
    }
