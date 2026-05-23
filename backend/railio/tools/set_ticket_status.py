"""Legal ticket status transitions."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from ..contract import TicketStatus
from ..db import session_scope
from ..messages_repo import _iso_now

_LEGAL: dict[str, list[str]] = {
    "AWAITING_TECH": ["IN_PROGRESS"],
    "IN_PROGRESS": ["AWAITING_REVIEW"],
    "AWAITING_REVIEW": ["CLOSED", "IN_PROGRESS"],
    "CLOSED": [],
}


async def set_ticket_status(ticket_id: int, status: TicketStatus) -> dict[str, Any]:
    async with session_scope() as session:
        row = (
            await session.execute(
                text("SELECT status FROM tickets WHERE id = :id"), {"id": ticket_id}
            )
        ).mappings().first()
        if not row:
            return {"error": f"ticket {ticket_id} not found"}
        current = row["status"]
        if status not in _LEGAL.get(current, []):
            return {"error": f"illegal transition {current} → {status}"}
        closed_at = _iso_now() if status == "CLOSED" else None
        await session.execute(
            text(
                """
                UPDATE tickets
                SET status = :st, closed_at = COALESCE(:closed_at, closed_at)
                WHERE id = :id
                """
            ),
            {"st": status, "closed_at": closed_at, "id": ticket_id},
        )
    return {"ok": True, "status": status}
