"""Ticket / form / ticket_parts repo."""

from __future__ import annotations

import json
import secrets
from typing import Optional

from sqlalchemy import text

from .assets_repo import _periods_for
from .contract import (
    Asset,
    Severity,
    Ticket,
    TicketDetail,
    TicketPart,
    TicketStatus,
)
from .corpus_repo import insert_corpus_chunk
from .db import session_scope
from .messages_repo import _iso_now, list_messages
from .pre_arrival import generate_pre_arrival_summary


async def get_asset(asset_id: int, org_id: Optional[int] = None) -> Optional[Asset]:
    # When org_id is given, a cross-org asset id resolves to None (404 upstream).
    where = "id = :id" + (" AND org_id = :org" if org_id is not None else "")
    params = {"id": asset_id}
    if org_id is not None:
        params["org"] = org_id
    async with session_scope() as session:
        row = (
            await session.execute(
                text(
                    f"""
                    SELECT id, org_id, reporting_mark, road_number, unit_model,
                           in_service_date, last_92_day_at, last_368_day_at,
                           last_1104_day_at, out_of_service, oos_since
                    FROM assets WHERE {where}
                    """
                ),
                params,
            )
        ).mappings().first()
        if not row:
            return None
        periods = await _periods_for(session, [row["id"]])
    return Asset(**row, oos_periods=periods.get(row["id"], []))


# short_id alphabet: lowercase + digits, minus look-alikes (o/0, i/1/l) for
# legibility when a tech reads a code off a screen.
_SHORT_ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def _gen_short_id() -> str:
    return "".join(secrets.choice(_SHORT_ID_ALPHABET) for _ in range(6))


def _derive_title(unit_model: str, symptoms: str | None, error_codes: str | None) -> str:
    """Readable ticket title from asset + intake. Kept short for list rows."""
    detail = (symptoms or "").strip() or (error_codes or "").strip() or "Maintenance ticket"
    detail = " ".join(detail.split())
    if len(detail) > 60:
        detail = detail[:57].rstrip() + "…"
    return f"{unit_model} — {detail}"


async def resolve_ticket_id(ref: str | int, org_id: Optional[int] = None) -> Optional[int]:
    """Map a user-facing ticket ref (short_id, or a numeric id for back-compat) to
    the internal int id, scoped to the org. Returns None if not found in the org."""
    s = str(ref).strip()
    where = ["short_id = :ref"]
    params: dict[str, object] = {"ref": s}
    if s.isdigit():
        where = ["(short_id = :ref OR id = :nref)"]
        params["nref"] = int(s)
    if org_id is not None:
        clause = " AND ".join(where) + " AND org_id = :org"
        params["org"] = org_id
    else:
        clause = " AND ".join(where)
    async with session_scope() as session:
        row = (
            await session.execute(
                text(f"SELECT id FROM tickets WHERE {clause}"), params
            )
        ).scalar_one_or_none()
    return int(row) if row is not None else None


async def list_tickets(
    status: Optional[TicketStatus] = None, org_id: Optional[int] = None
) -> list[Ticket]:
    where: list[str] = []
    params: dict[str, object] = {}
    if org_id is not None:
        where.append("org_id = :org")
        params["org"] = org_id
    if status:
        where.append("status = :st")
        params["st"] = status
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(f"SELECT * FROM tickets{clause} ORDER BY id DESC"), params
            )
        ).mappings().all()
    return [await _row_to_ticket(r) for r in rows]


async def get_ticket(ticket_id: int, org_id: Optional[int] = None) -> Optional[Ticket]:
    where = "id = :id" + (" AND org_id = :org" if org_id is not None else "")
    params = {"id": ticket_id}
    if org_id is not None:
        params["org"] = org_id
    async with session_scope() as session:
        row = (
            await session.execute(
                text(f"SELECT * FROM tickets WHERE {where}"), params
            )
        ).mappings().first()
    return await _row_to_ticket(row) if row else None


async def get_ticket_detail(
    ticket_id: int, org_id: Optional[int] = None
) -> Optional[TicketDetail]:
    t = await get_ticket(ticket_id, org_id)
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
        short_id=r["short_id"],
        title=r.get("title"),
        org_id=r["org_id"] if r.get("org_id") is not None else asset.org_id,
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


async def delete_ticket(ticket_id: int, org_id: Optional[int] = None) -> bool:
    where = "id = :id" + (" AND org_id = :org" if org_id is not None else "")
    params = {"id": ticket_id}
    if org_id is not None:
        params["org"] = org_id
    async with session_scope() as session:
        exists = (
            await session.execute(
                text(f"SELECT id FROM tickets WHERE {where}"), params
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
        # Promoted repair-history chunks have no FK back to the ticket, so they'd
        # orphan unless removed explicitly (tribal_capture cascades, but the chunk
        # it points at does not).
        await session.execute(
            text(
                """
                DELETE FROM corpus_chunks WHERE id IN (
                    SELECT promoted_chunk_id FROM tribal_capture
                    WHERE ticket_id = :id AND promoted_chunk_id IS NOT NULL
                )
                """
            ),
            {"id": ticket_id},
        )
        await session.execute(
            text("DELETE FROM tribal_capture WHERE ticket_id = :id"), {"id": ticket_id}
        )
        await session.execute(
            text("DELETE FROM tickets WHERE id = :id"), {"id": ticket_id}
        )
    return True


async def reset_ticket(ticket_id: int, org_id: Optional[int] = None) -> bool:
    """Demo-only: wipe the conversation and restore the ticket's original state."""
    where = "id = :id" + (" AND org_id = :org" if org_id is not None else "")
    exists_params = {"id": ticket_id}
    if org_id is not None:
        exists_params["org"] = org_id
    async with session_scope() as session:
        exists = (
            await session.execute(
                text(f"SELECT id FROM tickets WHERE {where}"), exists_params
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
        # Remove any wrap-up artifacts so re-running the demo scenario is clean.
        await session.execute(
            text(
                """
                DELETE FROM corpus_chunks WHERE id IN (
                    SELECT promoted_chunk_id FROM tribal_capture
                    WHERE ticket_id = :id AND promoted_chunk_id IS NOT NULL
                )
                """
            ),
            {"id": ticket_id},
        )
        await session.execute(
            text("DELETE FROM tribal_capture WHERE ticket_id = :id"), {"id": ticket_id}
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


async def finalize_wrap_up(
    ticket_id: int,
    *,
    summary: str,
    notes: Optional[str],
    author: Optional[str] = None,
    org_id: Optional[int] = None,
) -> Optional[int]:
    """File a closed ticket's repair record into the unit's corpus.

    Writes a tribal_knowledge chunk scoped to the org + asset (so it surfaces in
    that unit's future chats and never leaks to another tenant), records the
    capture in tribal_capture, and closes the ticket. Returns the new chunk id.
    """
    t = await get_ticket_detail(ticket_id, org_id)
    if not t:
        return None
    a = t.asset

    parts_lines = []
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT p.part_number, p.name, tp.qty
                    FROM ticket_parts tp JOIN parts p ON p.id = tp.part_id
                    WHERE tp.ticket_id = :tid ORDER BY tp.id
                    """
                ),
                {"tid": ticket_id},
            )
        ).mappings().all()
        for r in rows:
            parts_lines.append(f"{r['qty']}× {r['name']} ({r['part_number']})")

    now = _iso_now()
    date = now[:10]
    body_parts = [
        f"Ticket {t.short_id} (closed {date}). "
        f"Unit: {a.reporting_mark} {a.unit_model} {a.road_number}.",
        f"Symptoms: {t.initial_symptoms or '—'}.",
        f"Error codes: {t.initial_error_codes or '—'}.",
        summary.strip(),
    ]
    if notes and notes.strip() and notes.strip() != "- No additional notes.":
        body_parts.append(f"Tech notes: {notes.strip()}")
    if parts_lines:
        body_parts.append("Parts used: " + "; ".join(parts_lines) + ".")
    text_body = "\n".join(body_parts)

    source_label = (
        f"Repair Record — {a.reporting_mark} {a.unit_model} {a.road_number} — "
        f"{date} — Ticket {t.short_id}"
    )
    doc_id = f"repair_{a.reporting_mark}_{a.road_number}_{date}_{t.short_id}".lower().replace(" ", "_")

    chunk_id = await insert_corpus_chunk(
        doc_class="tribal_knowledge",
        doc_id=doc_id,
        doc_title=f"Repair Record — {a.reporting_mark} {a.unit_model} {a.road_number}",
        source_label=source_label,
        text_body=text_body,
        org_id=a.org_id,
        unit_model=a.unit_model,
        asset_id=a.id,
    )

    async with session_scope() as session:
        await session.execute(
            text(
                """
                INSERT INTO tribal_capture (ticket_id, author, text, captured_at, promoted_chunk_id)
                VALUES (:tid, :author, :text, :at, :chunk)
                """
            ),
            {
                "tid": ticket_id,
                "author": author,
                "text": text_body,
                "at": now,
                "chunk": chunk_id,
            },
        )
        await session.execute(
            text(
                "UPDATE tickets SET status = 'CLOSED', closed_at = :at WHERE id = :id"
            ),
            {"at": now, "id": ticket_id},
        )
    return chunk_id


async def create_ticket(
    *,
    asset_id: int,
    org_id: Optional[int] = None,
    title: str | None = None,
    initial_symptoms: str | None = None,
    initial_error_codes: str | None = None,
    fault_dump_raw: str | None = None,
    severity: Severity | None = None,
) -> Ticket:
    # Validate the asset within the caller's org (rejects cross-org asset ids).
    asset = await get_asset(asset_id, org_id)
    if not asset:
        raise ValueError(f"asset {asset_id} not found")
    # The ticket's org is a denormalized copy of its asset's org.
    ticket_org = asset.org_id
    opened_at = _iso_now()
    sev: Severity = severity or "major"
    ticket_title = (title or "").strip() or _derive_title(
        asset.unit_model, initial_symptoms, initial_error_codes
    )

    async with session_scope() as session:
        # Pick a short_id not already taken, then insert once. Collisions are
        # astronomically unlikely (31^6 codes), but the unique index is the
        # backstop; pre-checking avoids a mid-transaction rollback.
        short_id = _gen_short_id()
        for _ in range(6):
            taken = (
                await session.execute(
                    text("SELECT 1 FROM tickets WHERE short_id = :s"), {"s": short_id}
                )
            ).scalar_one_or_none()
            if not taken:
                break
            short_id = _gen_short_id()
        ticket_id = (
            await session.execute(
                text(
                    """
                    INSERT INTO tickets (
                        org_id, asset_id, title, short_id, status, severity,
                        opened_by_role, opened_at,
                        initial_error_codes, initial_symptoms, fault_dump_raw
                    )
                    VALUES (
                        :org_id, :asset_id, :title, :short_id, 'AWAITING_TECH', :sev,
                        'dispatcher', :opened_at,
                        :err, :sym, :raw
                    )
                    RETURNING id
                    """
                ),
                {
                    "org_id": ticket_org,
                    "asset_id": asset_id,
                    "title": ticket_title,
                    "short_id": short_id,
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
