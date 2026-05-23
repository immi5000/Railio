"""Parts CRUD."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from ..db import session_scope

router = APIRouter()

_COLS = {
    "part_number",
    "name",
    "description",
    "compatible_units",
    "bin_location",
    "qty_on_hand",
    "supplier",
    "lead_time_days",
    "alternate_part_numbers",
    "last_used_at",
}
_JSONB_COLS = {"compatible_units", "alternate_part_numbers"}


def _row_to_part(r) -> dict[str, Any]:
    return {
        "id": r["id"],
        "part_number": r["part_number"],
        "name": r["name"],
        "description": r["description"],
        "compatible_units": r["compatible_units"] or [],
        "bin_location": r["bin_location"],
        "qty_on_hand": r["qty_on_hand"],
        "supplier": r["supplier"],
        "lead_time_days": r["lead_time_days"],
        "alternate_part_numbers": r["alternate_part_numbers"] or [],
        "last_used_at": r["last_used_at"],
    }


@router.get("")
async def list_parts(
    unit_model: Optional[str] = None, q: Optional[str] = None
) -> JSONResponse:
    like = f"%{q}%" if q else None
    async with session_scope() as session:
        if unit_model and like:
            rows = (
                await session.execute(
                    text(
                        """
                        SELECT * FROM parts p
                        WHERE p.compatible_units ? :unit
                          AND (p.name ILIKE :like OR p.description ILIKE :like OR p.part_number ILIKE :like)
                        ORDER BY p.name ASC
                        """
                    ),
                    {"unit": unit_model, "like": like},
                )
            ).mappings().all()
        elif unit_model:
            rows = (
                await session.execute(
                    text(
                        """
                        SELECT * FROM parts p
                        WHERE p.compatible_units ? :unit
                        ORDER BY p.name ASC
                        """
                    ),
                    {"unit": unit_model},
                )
            ).mappings().all()
        elif like:
            rows = (
                await session.execute(
                    text(
                        """
                        SELECT * FROM parts p
                        WHERE p.name ILIKE :like OR p.description ILIKE :like OR p.part_number ILIKE :like
                        ORDER BY p.name ASC
                        """
                    ),
                    {"like": like},
                )
            ).mappings().all()
        else:
            rows = (
                await session.execute(text("SELECT * FROM parts p ORDER BY p.name ASC"))
            ).mappings().all()
    return JSONResponse([_row_to_part(r) for r in rows])


@router.patch("/{part_id}")
async def patch_part(part_id: int, request: Request) -> JSONResponse:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="bad body")
    updates = {k: v for k, v in body.items() if k in _COLS}
    if not updates:
        raise HTTPException(status_code=400, detail="no valid fields")

    async with session_scope() as session:
        for k, v in updates.items():
            col = k  # whitelisted
            if k in _JSONB_COLS:
                stmt = (
                    text(f"UPDATE parts SET {col} = :v WHERE id = :id")
                    .bindparams(bindparam("v", type_=JSONB))
                )
                await session.execute(stmt, {"v": v, "id": part_id})
            else:
                await session.execute(
                    text(f"UPDATE parts SET {col} = :v WHERE id = :id"),
                    {"v": v, "id": part_id},
                )
        row = (
            await session.execute(
                text("SELECT * FROM parts WHERE id = :id"), {"id": part_id}
            )
        ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return JSONResponse(_row_to_part(row))
