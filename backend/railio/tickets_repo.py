"""Ticket / form / ticket_parts repo."""

from __future__ import annotations

import json
from typing import Optional

from sqlalchemy import text

from .contract import (
    Asset,
    Severity,
    Ticket,
    TicketDetail,
    TicketPart,
    TicketStatus,
)
from .db import session_scope
from .messages_repo import _iso_now, list_messages
from .pre_arrival import generate_pre_arrival_summary


async def get_asset(asset_id: int) -> Optional[Asset]:
    async with session_scope() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT id, reporting_mark, road_number, unit_model,
                           in_service_date, last_inspection_at
                    FROM assets WHERE id = :id
                    """
                ),
                {"id": asset_id},
            )
        ).mappings().first()
    return Asset(**row) if row else None


async def list_tickets(status: Optional[TicketStatus] = None) -> list[Ticket]:
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT * FROM tickets WHERE status = :st ORDER BY id DESC"
                    if status
                    else "SELECT * FROM tickets ORDER BY id DESC"
                ),
                {"st": status} if status else {},
            )
        ).mappings().all()
    return [await _row_to_ticket(r) for r in rows]


async def get_ticket(ticket_id: int) -> Optional[Ticket]:
    async with session_scope() as session:
        row = (
            await session.execute(
                text("SELECT * FROM tickets WHERE id = :id"), {"id": ticket_id}
            )
        ).mappings().first()
    return await _row_to_ticket(row) if row else None


async def get_ticket_detail(ticket_id: int) -> Optional[TicketDetail]:
    t = await get_ticket(ticket_id)
    if not t:
        return None
    messages = await list_messages(ticket_id)
    ticket_parts = await list_ticket_parts(ticket_id)
    return TicketDetail(**t.model_dump(), messages=messages, ticket_parts=ticket_parts)


async def _ticket_is_pristine(ticket_id: int, status: str, has_parsed: bool) -> bool:
    if status != "AWAITING_TECH" or has_parsed:
        return False
    async with session_scope() as session:
        counts = (
            await session.execute(
                text(
                    """
                    SELECT
                        (SELECT count(*) FROM messages WHERE ticket_id = :id) AS msgs,
                        (SELECT count(*) FROM ticket_parts WHERE ticket_id = :id) AS parts
                    """
                ),
                {"id": ticket_id},
            )
        ).mappings().first()
    return counts["msgs"] == 0 and counts["parts"] == 0


async def _row_to_ticket(r) -> Ticket:
    asset = await get_asset(r["asset_id"])
    assert asset is not None
    fault_dump_parsed = None
    if r.get("fault_dump_parsed"):
        try:
            fault_dump_parsed = json.loads(r["fault_dump_parsed"])
        except (TypeError, ValueError):
            fault_dump_parsed = None
    is_pristine = await _ticket_is_pristine(
        r["id"], r["status"], bool(r.get("fault_dump_parsed"))
    )
    return Ticket(
        id=r["id"],
        asset=asset,
        status=r["status"],
        severity=(r.get("severity") or "major"),
        opened_at=r["opened_at"],
        initial_error_codes=r.get("initial_error_codes"),
        initial_symptoms=r.get("initial_symptoms"),
        fault_dump_raw=r.get("fault_dump_raw"),
        fault_dump_parsed=fault_dump_parsed,
        pre_arrival_summary=r.get("pre_arrival_summary"),
        closed_at=r.get("closed_at"),
        is_pristine=is_pristine,
    )


async def list_ticket_parts(ticket_id: int) -> list[TicketPart]:
    async with session_scope() as session:
        rows = (
            await session.execute(
                text("SELECT * FROM ticket_parts WHERE ticket_id = :tid ORDER BY id ASC"),
                {"tid": ticket_id},
            )
        ).mappings().all()
    return [
        TicketPart(
            id=r["id"],
            part_id=r["part_id"],
            qty=r["qty"],
            added_via=r["added_via"],
            added_at=r["added_at"],
        )
        for r in rows
    ]


async def delete_ticket(ticket_id: int) -> bool:
    async with session_scope() as session:
        exists = (
            await session.execute(
                text("SELECT id FROM tickets WHERE id = :id"), {"id": ticket_id}
            )
        ).scalar_one_or_none()
        if not exists:
            return False
        for stmt in (
            "DELETE FROM messages WHERE ticket_id = :id",
            "DELETE FROM ticket_parts WHERE ticket_id = :id",
            "DELETE FROM tickets WHERE id = :id",
        ):
            await session.execute(text(stmt), {"id": ticket_id})
    return True


async def reset_ticket(ticket_id: int) -> bool:
    """Demo-only: wipe the conversation and restore the ticket's original state."""
    async with session_scope() as session:
        exists = (
            await session.execute(
                text("SELECT id FROM tickets WHERE id = :id"), {"id": ticket_id}
            )
        ).scalar_one_or_none()
        if not exists:
            return False
        await session.execute(
            text("DELETE FROM messages WHERE ticket_id = :id"), {"id": ticket_id}
        )
        await session.execute(
            text("DELETE FROM ticket_parts WHERE ticket_id = :id"), {"id": ticket_id}
        )
        await session.execute(
            text(
                """
                UPDATE tickets
                SET status = 'AWAITING_TECH', fault_dump_parsed = NULL, closed_at = NULL
                WHERE id = :id
                """
            ),
            {"id": ticket_id},
        )
    return True


async def create_ticket(
    *,
    asset_id: int,
    initial_symptoms: str | None = None,
    initial_error_codes: str | None = None,
    fault_dump_raw: str | None = None,
    severity: Severity | None = None,
) -> Ticket:
    asset = await get_asset(asset_id)
    if not asset:
        raise ValueError(f"asset {asset_id} not found")
    opened_at = _iso_now()
    sev: Severity = severity or "major"

    async with session_scope() as session:
        ticket_id = (
            await session.execute(
                text(
                    """
                    INSERT INTO tickets (
                        asset_id, status, severity, opened_by_role, opened_at,
                        initial_error_codes, initial_symptoms, fault_dump_raw
                    )
                    VALUES (
                        :asset_id, 'AWAITING_TECH', :sev, 'dispatcher', :opened_at,
                        :err, :sym, :raw
                    )
                    RETURNING id
                    """
                ),
                {
                    "asset_id": asset_id,
                    "sev": sev,
                    "opened_at": opened_at,
                    "err": initial_error_codes,
                    "sym": initial_symptoms,
                    "raw": fault_dump_raw,
                },
            )
        ).scalar_one()

    # Best-effort pre-arrival brief. Failure must not break ticket creation.
    try:
        summary = await generate_pre_arrival_summary(
            asset=asset,
            severity=sev,
            initial_symptoms=initial_symptoms,
            initial_error_codes=initial_error_codes,
            fault_dump_raw=fault_dump_raw,
        )
        if summary:
            async with session_scope() as session:
                await session.execute(
                    text("UPDATE tickets SET pre_arrival_summary = :s WHERE id = :id"),
                    {"s": summary, "id": int(ticket_id)},
                )
    except Exception as e:  # pragma: no cover
        print(f"[create_ticket] pre-arrival generation failed: {e}")

    t = await get_ticket(int(ticket_id))
    assert t is not None
    return t
