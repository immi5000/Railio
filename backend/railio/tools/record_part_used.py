"""Record a part as used."""

from __future__ import annotations

from typing import Any, Callable

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

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

        now = _iso_now()
        await session.execute(
            text(
                """
                INSERT INTO ticket_parts (ticket_id, part_id, qty, added_via, added_at)
                VALUES (:tid, :pid, :qty, 'ai_suggestion', :now)
                """
            ),
            {"tid": ticket_id, "pid": part_id, "qty": qty, "now": now},
        )

        form_row = (
            await session.execute(
                text(
                    """
                    SELECT payload FROM forms
                    WHERE ticket_id = :tid AND form_type = 'F6180_49A'
                    """
                ),
                {"tid": ticket_id},
            )
        ).mappings().first()
        if form_row:
            payload = dict(form_row["payload"]) if form_row["payload"] else {}
            repairs = payload.get("repairs") or []
            if repairs:
                last = repairs[-1]
                parts_replaced = list(last.get("parts_replaced") or [])
                parts_replaced.extend([part["part_number"]] * int(qty))
                last["parts_replaced"] = parts_replaced
                payload["repairs"] = repairs
                stmt = (
                    text(
                        """
                        UPDATE forms SET payload = :payload, updated_at = :now
                        WHERE ticket_id = :tid AND form_type = 'F6180_49A'
                        """
                    )
                    .bindparams(bindparam("payload", type_=JSONB))
                )
                await session.execute(
                    stmt, {"payload": payload, "now": now, "tid": ticket_id}
                )
                emit(
                    {
                        "type": "form_updated",
                        "form_type": "F6180_49A",
                        "payload": payload,
                    }
                )

    return {
        "ok": True,
        "part_number": part["part_number"],
        "name": part["name"],
        "bin_location": part["bin_location"],
        "qty": qty,
    }
