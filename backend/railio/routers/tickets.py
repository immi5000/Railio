"""Ticket CRUD."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse

from ..contract import (
    CreateTicketBody,
    FinalizeWrapUpBody,
    Organization,
    PatchTicketBody,
    TicketStatus,
)
from ..org_context import get_current_org
from ..post_repair import draft_repair_record
from ..tickets_repo import (
    create_ticket,
    delete_ticket,
    finalize_wrap_up,
    get_ticket_detail,
    list_tickets,
    reset_ticket,
)
from ..db import session_scope
from sqlalchemy import text

router = APIRouter()

_SEVERITIES = {"minor", "major", "critical"}


@router.get("")
async def list_tickets_route(
    status: Optional[TicketStatus] = None,
    org: Organization = Depends(get_current_org),
) -> JSONResponse:
    rows = await list_tickets(status, org.id)
    return JSONResponse([t.model_dump(by_alias=True) for t in rows])


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_ticket_route(
    body: CreateTicketBody, org: Organization = Depends(get_current_org)
) -> JSONResponse:
    if body.severity is not None and body.severity not in _SEVERITIES:
        raise HTTPException(status_code=400, detail="invalid severity")
    try:
        t = await create_ticket(
            asset_id=body.asset_id,
            org_id=org.id,
            initial_symptoms=body.initial_symptoms,
            initial_error_codes=body.initial_error_codes,
            fault_dump_raw=body.fault_dump_raw,
            severity=body.severity,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return JSONResponse(t.model_dump(by_alias=True), status_code=201)


@router.get("/{ticket_id}")
async def get_ticket_route(
    ticket_id: int, org: Organization = Depends(get_current_org)
) -> JSONResponse:
    t = await get_ticket_detail(ticket_id, org.id)
    if not t:
        raise HTTPException(status_code=404, detail="not found")
    return JSONResponse(t.model_dump(by_alias=True))


@router.patch("/{ticket_id}")
async def patch_ticket_route(
    ticket_id: int,
    body: PatchTicketBody,
    org: Organization = Depends(get_current_org),
) -> JSONResponse:
    if body.severity is not None and body.severity not in _SEVERITIES:
        raise HTTPException(status_code=400, detail="invalid severity")
    if body.status is None and body.pre_arrival_summary is None and body.severity is None:
        raise HTTPException(status_code=400, detail="no fields to update")

    # Every UPDATE carries AND org_id so a tenant can't mutate another's ticket.
    async with session_scope() as session:
        if body.status is not None:
            await session.execute(
                text("UPDATE tickets SET status = :v WHERE id = :id AND org_id = :org"),
                {"v": body.status, "id": ticket_id, "org": org.id},
            )
        if body.pre_arrival_summary is not None:
            await session.execute(
                text(
                    "UPDATE tickets SET pre_arrival_summary = :v WHERE id = :id AND org_id = :org"
                ),
                {"v": body.pre_arrival_summary, "id": ticket_id, "org": org.id},
            )
        if body.severity is not None:
            await session.execute(
                text("UPDATE tickets SET severity = :v WHERE id = :id AND org_id = :org"),
                {"v": body.severity, "id": ticket_id, "org": org.id},
            )
    t = await get_ticket_detail(ticket_id, org.id)
    if not t:
        raise HTTPException(status_code=404, detail="not found")
    return JSONResponse(t.model_dump(by_alias=True))


@router.delete("/{ticket_id}")
async def delete_ticket_route(
    ticket_id: int, org: Organization = Depends(get_current_org)
) -> JSONResponse:
    ok = await delete_ticket(ticket_id, org.id)
    if not ok:
        raise HTTPException(status_code=404, detail="not found")
    return JSONResponse({"deleted": True})


@router.get("/{ticket_id}/wrap-up/draft")
async def wrap_up_draft_route(
    ticket_id: int, org: Organization = Depends(get_current_org)
) -> JSONResponse:
    t = await get_ticket_detail(ticket_id, org.id)
    if not t:
        raise HTTPException(status_code=404, detail="not found")
    draft = await draft_repair_record(ticket_id)
    return JSONResponse(draft)


@router.post("/{ticket_id}/wrap-up")
async def wrap_up_finalize_route(
    ticket_id: int,
    body: FinalizeWrapUpBody,
    org: Organization = Depends(get_current_org),
) -> JSONResponse:
    if not body.summary.strip():
        raise HTTPException(status_code=400, detail="summary required")
    chunk_id = await finalize_wrap_up(
        ticket_id,
        summary=body.summary,
        notes=body.notes,
        author=body.author,
        org_id=org.id,
    )
    if chunk_id is None:
        raise HTTPException(status_code=404, detail="ticket not found")
    t = await get_ticket_detail(ticket_id, org.id)
    return JSONResponse({"chunk_id": chunk_id, "ticket": t.model_dump(by_alias=True)})


@router.post("/{ticket_id}/reset")
async def reset_ticket_route(
    ticket_id: int, org: Organization = Depends(get_current_org)
) -> JSONResponse:
    ok = await reset_ticket(ticket_id, org.id)
    if not ok:
        raise HTTPException(status_code=404, detail="not found")
    return JSONResponse({"reset": True})
