"""Legal ticket status transitions."""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import text

from ..contract import TicketStatus
from ..db import session_scope
from ..messages_repo import _iso_now

_LEGAL: dict[str, list[str]] = {
    "AWAITING_HANDOFF": ["AWAITING_TECH"],
    "AWAITING_TECH": ["IN_PROGRESS"],
    "IN_PROGRESS": ["AWAITING_REVIEW"],
    "AWAITING_REVIEW": ["CLOSED", "IN_PROGRESS"],
    "CLOSED": [],
}


def transition_error(current: str, target: str) -> Optional[str]:
    """None when current → target is allowed by the table, else why it isn't.

    Strictly the table, including same-status: no row lists itself, so
    re-asserting a status is an error here. chat_loop depends on that — it fires
    set_ticket_status on every tech message and relies on the rejection to make
    the AWAITING_TECH → IN_PROGRESS move happen exactly once. Callers that want
    idempotence (the PATCH route, where a double-clicked button is not a bug)
    check for it before asking.
    """
    if target not in _LEGAL.get(current, []):
        return f"illegal transition {current} → {target}"
    return None


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
        err = transition_error(current, status)
        if err:
            return {"error": err}
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
