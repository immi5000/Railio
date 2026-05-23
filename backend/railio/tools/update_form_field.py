"""Update one field on a form."""

from __future__ import annotations

from typing import Any, Callable

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from ..contract import FormType
from ..db import session_scope
from ..field_path import apply_field_path, validate_field_path
from ..messages_repo import _iso_now

ToolEmit = Callable[[dict[str, Any]], None]


async def update_form_field(
    *,
    ticket_id: int,
    form_type: FormType,
    field_path: str,
    value: Any,
    source_message_id: int,
    emit: ToolEmit,
) -> dict[str, Any]:
    if not validate_field_path(form_type, field_path):
        return {"error": f"invalid field_path '{field_path}' for form {form_type}"}

    async with session_scope() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT payload FROM forms
                    WHERE ticket_id = :tid AND form_type = :ft
                    """
                ),
                {"tid": ticket_id, "ft": form_type},
            )
        ).mappings().first()
        if not row:
            return {"error": f"form {form_type} not found for ticket {ticket_id}"}

        payload = row["payload"] if isinstance(row["payload"], dict) else dict(row["payload"])
        updated = apply_field_path(payload, field_path, value)
        now = _iso_now()
        stmt = (
            text(
                """
                UPDATE forms SET payload = :payload, updated_at = :now
                WHERE ticket_id = :tid AND form_type = :ft
                """
            )
            .bindparams(bindparam("payload", type_=JSONB))
        )
        await session.execute(
            stmt, {"payload": updated, "now": now, "tid": ticket_id, "ft": form_type}
        )

    emit({"type": "form_updated", "form_type": form_type, "payload": updated})
    return {"ok": True, "form_type": form_type, "field_path": field_path}
