"""Ticket / form / ticket_parts repo."""

from __future__ import annotations

import json
import secrets
from typing import Optional

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from .assets_repo import _periods_for
from .contract import (
    Asset,
    Severity,
    Ticket,
    TicketDetail,
    TicketPart,
    TicketStatus,
    WrapUpPartEntry,
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
    # Both pre-work states count: AWAITING_HANDOFF (dispatcher hasn't handed off
    # yet) and AWAITING_TECH (handed off, tech hasn't spoken). Neither has done
    # anything worth resetting away from.
    if status not in ("AWAITING_HANDOFF", "AWAITING_TECH") or has_parsed:
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
            allocations=r["allocations"],
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
                SET status = 'AWAITING_HANDOFF', fault_dump_parsed = NULL, closed_at = NULL
                WHERE id = :id
                """
            ),
            {"id": ticket_id},
        )
    return True


async def _record_manual_parts(
    ticket_id: int,
    parts: list["WrapUpPartEntry"],
    org_id: Optional[int],
) -> None:
    """Insert tech-entered wrap-up parts as tech_manual ticket_parts rows.

    Inventory is NOT drawn down here — `finalize_wrap_up` decrements every
    ticket_part once at close, so manual, button-added, and AI-recorded parts
    all draw down exactly once (no double-count). Parts are validated against
    the caller's org so a tenant can't touch another's inventory; unknown/
    cross-org part ids are skipped.
    """
    now = _iso_now()
    async with session_scope() as session:
        for entry in parts:
            qty = int(entry.qty)
            if qty <= 0:
                continue
            # Scope the part to the org (when known) before inserting.
            where = "id = :pid" + (" AND org_id = :org" if org_id is not None else "")
            params: dict[str, object] = {"pid": entry.part_id}
            if org_id is not None:
                params["org"] = org_id
            exists = (
                await session.execute(
                    text(f"SELECT id FROM parts WHERE {where}"), params
                )
            ).scalar_one_or_none()
            if exists is None:
                continue
            await session.execute(
                text(
                    """
                    INSERT INTO ticket_parts (ticket_id, part_id, qty, added_via, added_at)
                    VALUES (:tid, :pid, :qty, 'tech_manual', :now)
                    """
                ),
                {"tid": ticket_id, "pid": entry.part_id, "qty": qty, "now": now},
            )


async def add_ticket_part(
    ticket_id: int,
    part_id: int,
    qty: int,
    allocations: Optional[list[dict]] = None,
    org_id: Optional[int] = None,
) -> bool:
    """Set a part's used-quantity on a ticket (from the chat parts picker).

    Idempotent upsert keyed on (ticket_id, part_id): if the part is already on
    the ticket its qty + per-bin `allocations` are set, otherwise a tech_manual
    row is inserted — so the +/- steppers set an absolute count and a part never
    lands on two rows. A qty <= 0 removes the part. Inventory is untouched until
    the ticket closes. The part is org-scoped so a tenant can't record another
    org's inventory. Returns False if the part is unknown/cross-org.
    """
    async with session_scope() as session:
        where = "id = :pid" + (" AND org_id = :org" if org_id is not None else "")
        params: dict[str, object] = {"pid": part_id}
        if org_id is not None:
            params["org"] = org_id
        exists = (
            await session.execute(text(f"SELECT id FROM parts WHERE {where}"), params)
        ).scalar_one_or_none()
        if exists is None:
            return False

        if qty <= 0:
            await session.execute(
                text(
                    "DELETE FROM ticket_parts WHERE ticket_id = :tid AND part_id = :pid"
                ),
                {"tid": ticket_id, "pid": part_id},
            )
            return True

        # Upsert: update the existing row's qty + allocations, else insert one.
        update_stmt = text(
            """
            UPDATE ticket_parts SET qty = :qty, allocations = :alloc
            WHERE ticket_id = :tid AND part_id = :pid
            """
        ).bindparams(bindparam("alloc", type_=JSONB))
        updated = (
            await session.execute(
                update_stmt,
                {"qty": qty, "alloc": allocations, "tid": ticket_id, "pid": part_id},
            )
        ).rowcount
        if not updated:
            insert_stmt = text(
                """
                INSERT INTO ticket_parts (ticket_id, part_id, qty, allocations, added_via, added_at)
                VALUES (:tid, :pid, :qty, :alloc, 'tech_manual', :now)
                """
            ).bindparams(bindparam("alloc", type_=JSONB))
            await session.execute(
                insert_stmt,
                {
                    "tid": ticket_id,
                    "pid": part_id,
                    "qty": qty,
                    "alloc": allocations,
                    "now": _iso_now(),
                },
            )
    return True


async def remove_ticket_part(
    ticket_id: int,
    part_id: int,
) -> None:
    """Remove a part from a ticket's used-parts (undo of the chat add button)."""
    async with session_scope() as session:
        await session.execute(
            text(
                "DELETE FROM ticket_parts WHERE ticket_id = :tid AND part_id = :pid"
            ),
            {"tid": ticket_id, "pid": part_id},
        )


async def _draw_down_parts(ticket_id: int, now: str, parts_lines: list[str]) -> None:
    """Draw every recorded part on the ticket down from inventory once, at close.

    For a part stocked across bins (parts.locations) the per-bin `allocations` the
    tech chose are subtracted from those exact bins; any unallocated remainder
    (AI-recorded/legacy rows) is auto-drawn from the fullest bins first, so
    qty_on_hand stays equal to the sum of the bin quantities. A part with no
    locations just decrements qty_on_hand by the total. Aggregated by part_id so a
    part decrements exactly once; `parts_lines` is filled with a readable summary.
    """
    from .parts_repo import derive_totals, normalize_locations

    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT tp.part_id, tp.qty, tp.allocations,
                           p.part_number, p.name, p.qty_on_hand, p.locations
                    FROM ticket_parts tp JOIN parts p ON p.id = tp.part_id
                    WHERE tp.ticket_id = :tid ORDER BY tp.id
                    """
                ),
                {"tid": ticket_id},
            )
        ).mappings().all()

        agg: dict[int, dict] = {}
        for r in rows:
            parts_lines.append(f"{r['qty']}× {r['name']} ({r['part_number']})")
            e = agg.setdefault(
                r["part_id"],
                {"total": 0, "alloc": {}, "locations": r["locations"]},
            )
            e["total"] += int(r["qty"])
            for a_ in r["allocations"] or []:
                loc = a_.get("location")
                if loc is None:
                    continue
                e["alloc"][loc] = e["alloc"].get(loc, 0) + int(a_.get("qty", 0))

        for pid, e in agg.items():
            locs = normalize_locations(e["locations"])
            if not locs:
                # No bin breakdown to keep in sync — decrement the flat total.
                await session.execute(
                    text(
                        """
                        UPDATE parts
                        SET qty_on_hand = GREATEST(0, qty_on_hand - :total),
                            last_used_at = :now
                        WHERE id = :pid
                        """
                    ),
                    {"total": e["total"], "now": now, "pid": pid},
                )
                continue

            draw = dict(e["alloc"])
            remainder = e["total"] - sum(draw.values())
            # Auto-draw any unallocated remainder from the fullest bins first.
            for loc in sorted(locs, key=lambda x: -x["qty"]):
                if remainder <= 0:
                    break
                free = max(0, int(loc["qty"]) - draw.get(loc["location"], 0))
                take = min(remainder, free)
                if take > 0:
                    draw[loc["location"]] = draw.get(loc["location"], 0) + take
                    remainder -= take

            new_locs = []
            for loc in locs:
                nl = dict(loc)
                nl["qty"] = max(0, int(loc["qty"]) - draw.get(loc["location"], 0))
                new_locs.append(nl)
            new_locs = normalize_locations(new_locs)  # recompute each bin's value
            qoh, avg, val = derive_totals(new_locs, 0, None)

            stmt = text(
                """
                UPDATE parts
                SET locations = :locs, qty_on_hand = :qoh,
                    avg_cost = :avg, on_hand_value = :val, last_used_at = :now
                WHERE id = :pid
                """
            ).bindparams(bindparam("locs", type_=JSONB))
            await session.execute(
                stmt,
                {
                    "locs": new_locs,
                    "qoh": qoh,
                    "avg": avg,
                    "val": val,
                    "now": now,
                    "pid": pid,
                },
            )


async def finalize_wrap_up(
    ticket_id: int,
    *,
    summary: str,
    notes: Optional[str],
    author: Optional[str] = None,
    org_id: Optional[int] = None,
    parts: Optional[list["WrapUpPartEntry"]] = None,
) -> Optional[int]:
    """File a closed ticket's repair record into the unit's corpus.

    Writes a tribal_knowledge chunk scoped to the org + asset (so it surfaces in
    that unit's future chats and never leaks to another tenant), records the
    capture in tribal_capture, and closes the ticket. Returns the new chunk id.

    Any `parts` the tech entered by hand at wrap-up are inserted as tech_manual
    ticket_parts first. Then every ticket_part on the ticket — manual,
    button-added, and AI-recorded — is drawn down from inventory exactly once
    (this is the sole draw-down point), and all appear in the filed record.
    """
    t = await get_ticket_detail(ticket_id, org_id)
    if not t:
        return None
    a = t.asset

    if parts:
        await _record_manual_parts(ticket_id, parts, org_id)

    now = _iso_now()
    parts_lines = []
    await _draw_down_parts(ticket_id, now, parts_lines)

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
                        :org_id, :asset_id, :title, :short_id, 'AWAITING_HANDOFF', :sev,
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
