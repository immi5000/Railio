"""POST /api/tickets/{id}/parse-fault-dump — direct, non-streaming parse."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..contract import Organization
from ..org_context import get_current_org
from ..tickets_repo import resolve_ticket_id
from ..tools.parse_fault_dump import parse_fault_dump

router = APIRouter()


class _Body(BaseModel):
    raw: str


@router.post("/{ticket_ref}/parse-fault-dump")
async def parse_fault_dump_route(
    ticket_ref: str,
    body: _Body,
    org: Organization = Depends(get_current_org),
) -> JSONResponse:
    if not body.raw:
        raise HTTPException(status_code=400, detail="raw required")
    ticket_id = await resolve_ticket_id(ticket_ref, org.id)
    if ticket_id is None:
        raise HTTPException(status_code=404, detail="not found")
    try:
        out = await parse_fault_dump(ticket_id=ticket_id, raw_text=body.raw)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return JSONResponse({"parsed": out["parsed"]})
