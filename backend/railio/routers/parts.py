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
from ..parts_repo import (
    BadLocations,
    DuplicatePartNumber,
    create_part,
    derive_totals,
    normalize_locations,
)

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


@router.get("/filter-options")
async def parts_filter_options(
    org: Organization = Depends(get_current_org),
) -> JSONResponse:
    """Distinct org-scoped values that populate the parts filter dropdowns."""
    loc_sql = text(
        "SELECT DISTINCT loc->>'location' AS v FROM parts p, "
        "jsonb_array_elements(COALESCE(p.locations, '[]'::jsonb)) loc "
        "WHERE p.org_id = :org AND loc->>'location' IS NOT NULL "
        "AND loc->>'location' <> '' ORDER BY 1"
    )
    sup_sql = text(
        "SELECT DISTINCT supplier FROM parts "
        "WHERE org_id = :org AND supplier IS NOT NULL AND supplier <> '' ORDER BY 1"
    )
    dep_sql = text(
        "SELECT DISTINCT department FROM parts "
        "WHERE org_id = :org AND department IS NOT NULL AND department <> '' ORDER BY 1"
    )
    async with session_scope() as session:
        locations = (await session.execute(loc_sql, {"org": org.id})).scalars().all()
        suppliers = (await session.execute(sup_sql, {"org": org.id})).scalars().all()
        departments = (await session.execute(dep_sql, {"org": org.id})).scalars().all()
    return JSONResponse(
        {
            "locations": list(locations),
            "suppliers": list(suppliers),
            "departments": list(departments),
        }
    )


@router.get("")
async def list_parts(
    unit_model: Optional[str] = None,
    q: Optional[str] = None,
    location: Optional[str] = None,
    supplier: Optional[str] = None,
    department: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    org: Organization = Depends(get_current_org),
) -> JSONResponse:
    limit = max(1, min(10000, int(limit or 100)))
    offset = max(0, int(offset or 0))
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
            "(p.name ILIKE :like OR p.description ILIKE :like "
            "OR p.part_number ILIKE :like OR p.bin_location ILIKE :like "
            "OR EXISTS (SELECT 1 FROM jsonb_array_elements("
            "COALESCE(p.locations, '[]'::jsonb)) loc "
            "WHERE loc->>'location' ILIKE :like))"
        )
        params["like"] = like
    if location:
        where.append(
            "p.locations @> jsonb_build_array("
            "jsonb_build_object('location', CAST(:location AS text)))"
        )
        params["location"] = location
    if supplier:
        where.append("p.supplier = :supplier")
        params["supplier"] = supplier
    if department:
        where.append("p.department = :department")
        params["department"] = department
    where_sql = " AND ".join(where)
    count_sql = text(f"SELECT COUNT(*) FROM parts p WHERE {where_sql}")
    # id tie-break keeps paging stable when names collide.
    page_sql = text(
        f"SELECT * FROM parts p WHERE {where_sql} "
        "ORDER BY p.name ASC, p.id ASC LIMIT :lim OFFSET :off"
    )
    page_params = {**params, "lim": limit, "off": offset}
    async with session_scope() as session:
        total = (await session.execute(count_sql, params)).scalar_one()
        rows = (await session.execute(page_sql, page_params)).mappings().all()
    return JSONResponse({"parts": [_row_to_part(r) for r in rows], "total": total})


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
            locations=[loc.model_dump() for loc in body.locations],
            department=body.department,
            subsidiary=body.subsidiary,
            inv_class=body.inv_class,
        )
    except BadLocations:
        raise HTTPException(status_code=400, detail="bad locations")
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

    if "locations" in updates:
        try:
            updates["locations"] = normalize_locations(updates["locations"])
        except BadLocations:
            raise HTTPException(status_code=400, detail="bad locations")

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

        # Derive from the *stored* row, not the request: a client that patches
        # only qty_on_hand or avg_cost on a part that has locations must not be
        # able to push the item totals out of step with its breakdown.
        qty, avg, value = derive_totals(
            row["locations"] or [], row["qty_on_hand"], _num(row["avg_cost"])
        )
        if (qty, avg, value) != (
            row["qty_on_hand"],
            _num(row["avg_cost"]),
            _num(row["on_hand_value"]),
        ):
            await session.execute(
                text(
                    "UPDATE parts SET qty_on_hand = :q, avg_cost = :a, on_hand_value = :v "
                    "WHERE id = :id AND org_id = :org"
                ),
                {"q": qty, "a": avg, "v": value, "id": part_id, "org": org.id},
            )
            row = (
                await session.execute(
                    text("SELECT * FROM parts WHERE id = :id AND org_id = :org"),
                    {"id": part_id, "org": org.id},
                )
            ).mappings().first()
    return JSONResponse(_row_to_part(row))
