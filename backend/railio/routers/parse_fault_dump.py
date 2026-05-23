"""POST /api/tickets/{id}/parse-fault-dump — direct, non-streaming parse."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..tools.parse_fault_dump import parse_fault_dump

router = APIRouter()


class _Body(BaseModel):
    raw: str


@router.post("/{ticket_id}/parse-fault-dump")
async def parse_fault_dump_route(ticket_id: int, body: _Body) -> JSONResponse:
    if not body.raw:
        raise HTTPException(status_code=400, detail="raw required")
    try:
        out = await parse_fault_dump(ticket_id=ticket_id, raw_text=body.raw)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return JSONResponse({"parsed": out["parsed"]})
