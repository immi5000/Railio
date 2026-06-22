"""Parts inventory repo — create.

Parts are normally bulk-loaded by scripts.load_org, but the admin Parts page also
creates them one at a time. part_number is unique per org (partial unique index),
so a duplicate raises rather than silently returning the existing row.
"""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError


class DuplicatePartNumber(Exception):
    """part_number already exists for this org."""


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


async def create_part(
    *,
    org_id: int,
    part_number: str,
    name: str,
    description: Optional[str] = None,
    compatible_units: Optional[list[str]] = None,
    bin_location: Optional[str] = None,
    qty_on_hand: int = 0,
    supplier: Optional[str] = None,
    lead_time_days: Optional[int] = None,
    alternate_part_numbers: Optional[list[str]] = None,
    avg_cost: Optional[float] = None,
) -> dict[str, Any]:
    from .db import session_scope

    stmt = text(
        """
        INSERT INTO parts (org_id, part_number, name, description, compatible_units,
                           bin_location, qty_on_hand, supplier, lead_time_days,
                           alternate_part_numbers, avg_cost)
        VALUES (:org, :pn, :name, :desc, :cu, :bin, :qty, :sup, :lead, :alt, :cost)
        RETURNING *
        """
    ).bindparams(
        bindparam("cu", type_=JSONB),
        bindparam("alt", type_=JSONB),
    )
    params = {
        "org": org_id,
        "pn": part_number,
        "name": name,
        "desc": description,
        "cu": compatible_units or [],
        "bin": bin_location,
        "qty": qty_on_hand,
        "sup": supplier,
        "lead": lead_time_days,
        "alt": alternate_part_numbers or [],
        "cost": avg_cost,
    }
    try:
        async with session_scope() as session:
            row = (await session.execute(stmt, params)).mappings().first()
    except IntegrityError as e:
        raise DuplicatePartNumber(part_number) from e
    return _row_to_part(row)
