"""Record a part as used."""

from __future__ import annotations

from typing import Any, Callable

from sqlalchemy import text

from ..db import session_scope
from ..messages_repo import _iso_now

ToolEmit = Callable[[dict[str, Any]], None]


async def record_part_used(
    *,
    ticket_id: int,
    part_id: int,
    qty: int,
    emit: ToolEmit,
) -> dict[str, Any]:
    async with session_scope() as session:
        part = (
            await session.execute(
                text("SELECT * FROM parts WHERE id = :id"), {"id": part_id}
            )
        ).mappings().first()
        if not part:
            return {"error": f"part {part_id} not found"}

        await session.execute(
            text(
                """
                INSERT INTO ticket_parts (ticket_id, part_id, qty, added_via, added_at)
                VALUES (:tid, :pid, :qty, 'ai_suggestion', :now)
                """
            ),
            {"tid": ticket_id, "pid": part_id, "qty": qty, "now": _iso_now()},
        )

    return {
        "ok": True,
        "part_number": part["part_number"],
        "name": part["name"],
        "bin_location": part["bin_location"],
        "qty": qty,
    }
