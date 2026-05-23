"""Forms list/patch/export routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from ..contract import FormType
from ..db import session_scope
from ..messages_repo import _iso_now
from ..pdf_templates import render_form_pdf
from ..tickets_repo import list_forms

router = APIRouter()

_FORM_TYPES = {"F6180_49A", "DAILY_INSPECTION_229_21"}


class _PatchBody(BaseModel):
    payload: dict[str, Any]


@router.get("/{ticket_id}/forms")
async def list_forms_route(ticket_id: int) -> JSONResponse:
    rows = await list_forms(ticket_id)
    return JSONResponse([f.model_dump(by_alias=True) for f in rows])


@router.patch("/{ticket_id}/forms/{form_type}")
async def patch_form_route(
    ticket_id: int, form_type: str, body: _PatchBody
) -> JSONResponse:
    if form_type not in _FORM_TYPES:
        raise HTTPException(status_code=400, detail="bad form_type")
    if not isinstance(body.payload, dict):
        raise HTTPException(status_code=400, detail="payload required")

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
            raise HTTPException(status_code=404, detail="form not found")
        merged = {**(row["payload"] or {}), **body.payload}
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
            stmt, {"payload": merged, "now": now, "tid": ticket_id, "ft": form_type}
        )
        updated = (
            await session.execute(
                text(
                    "SELECT * FROM forms WHERE ticket_id = :tid AND form_type = :ft"
                ),
                {"tid": ticket_id, "ft": form_type},
            )
        ).mappings().first()
    return JSONResponse(
        {
            "ticket_id": updated["ticket_id"],
            "form_type": updated["form_type"],
            "payload": updated["payload"],
            "status": updated["status"],
            "pdf_path": updated["pdf_path"],
            "updated_at": updated["updated_at"],
        }
    )


@router.post("/{ticket_id}/forms/{form_type}/export")
async def export_form_route(ticket_id: int, form_type: str) -> JSONResponse:
    if form_type not in _FORM_TYPES:
        raise HTTPException(status_code=400, detail="bad form_type")
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
            raise HTTPException(status_code=404, detail="form not found")

    pdf_path = await render_form_pdf(
        ticket_id, form_type, row["payload"]  # type: ignore[arg-type]
    )

    async with session_scope() as session:
        now = _iso_now()
        await session.execute(
            text(
                """
                UPDATE forms
                SET pdf_path = :pdf, status = 'exported', updated_at = :now
                WHERE ticket_id = :tid AND form_type = :ft
                """
            ),
            {"pdf": pdf_path, "now": now, "tid": ticket_id, "ft": form_type},
        )
    return JSONResponse({"pdf_path": pdf_path})
