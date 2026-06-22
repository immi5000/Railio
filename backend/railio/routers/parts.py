"""Parts CRUD."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from ..contract import CreatePartBody, Organization
from ..db import session_scope
from ..org_context import get_current_org
from ..parts_repo import DuplicatePartNumber, create_part

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
    "avg_cost",
    "on_hand_value",
    "locations",
    "department",
    "subsidiary",
    "inv_class",
}
_JSONB_COLS = {"compatible_units", "alternate_part_numbers", "locations"}


def _num(v) -> Optional[float]:
    return float(v) if v is not None else None


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
        "avg_cost": _num(r["avg_cost"]),
        "on_hand_value": _num(r["on_hand_value"]),
        "locations": r["locations"] or [],
        "department": r["department"],
        "subsidiary": r["subsidiary"],
        "inv_class": r["inv_class"],
    }


@router.get("")
async def list_parts(
    unit_model: Optional[str] = None,
    q: Optional[str] = None,
    org: Organization = Depends(get_current_org),
) -> JSONResponse:
    like = f"%{q}%" if q else None
    params: dict[str, Any] = {"org": org.id}
    where = ["p.org_id = :org"]
    if unit_model:
        where.append(
            "(p.compatible_units IS NULL OR p.compatible_units = '[]'::jsonb "
            "OR p.compatible_units ? :unit)"
        )
        params["unit"] = unit_model
    if like:
        where.append(
            "(p.name ILIKE :like OR p.description ILIKE :like OR p.part_number ILIKE :like)"
        )
        params["like"] = like
    sql = text(
        f"SELECT * FROM parts p WHERE {' AND '.join(where)} ORDER BY p.name ASC"
    )
    async with session_scope() as session:
        rows = (await session.execute(sql, params)).mappings().all()
    return JSONResponse([_row_to_part(r) for r in rows])


@router.post("")
async def post_part(
    body: CreatePartBody, org: Organization = Depends(get_current_org)
) -> JSONResponse:
    try:
        part = await create_part(
            org_id=org.id,
            part_number=body.part_number,
            name=body.name,
            description=body.description,
            compatible_units=body.compatible_units,
            bin_location=body.bin_location,
            qty_on_hand=body.qty_on_hand,
            supplier=body.supplier,
            lead_time_days=body.lead_time_days,
            alternate_part_numbers=body.alternate_part_numbers,
            avg_cost=body.avg_cost,
        )
    except DuplicatePartNumber:
        raise HTTPException(status_code=409, detail="part number already exists")
    return JSONResponse(part)


@router.patch("/{part_id}")
async def patch_part(
    part_id: int,
    request: Request,
    org: Organization = Depends(get_current_org),
) -> JSONResponse:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="bad body")
    updates = {k: v for k, v in body.items() if k in _COLS}
    if not updates:
        raise HTTPException(status_code=400, detail="no valid fields")

    async with session_scope() as session:
        # The WHERE includes org_id so a tenant can only mutate its own parts.
        for k, v in updates.items():
            col = k  # whitelisted
            if k in _JSONB_COLS:
                stmt = (
                    text(f"UPDATE parts SET {col} = :v WHERE id = :id AND org_id = :org")
                    .bindparams(bindparam("v", type_=JSONB))
                )
                await session.execute(stmt, {"v": v, "id": part_id, "org": org.id})
            else:
                await session.execute(
                    text(f"UPDATE parts SET {col} = :v WHERE id = :id AND org_id = :org"),
                    {"v": v, "id": part_id, "org": org.id},
                )
        row = (
            await session.execute(
                text("SELECT * FROM parts WHERE id = :id AND org_id = :org"),
                {"id": part_id, "org": org.id},
            )
        ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return JSONResponse(_row_to_part(row))
