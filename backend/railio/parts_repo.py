"""Parts inventory repo — create, plus the shared location/total derivation.

Parts are normally bulk-loaded by scripts.load_org, but the admin Parts page also
creates them one at a time. part_number is unique per org (partial unique index),
so a duplicate raises rather than silently returning the existing row.

normalize_locations/derive_totals are the single definition of how a part's
item-level numbers relate to its per-location breakdown; routers/parts.py imports
them so create and patch can never disagree. frontend/lib/parts.ts mirrors
derive_totals exactly (same rounding) so the live UI number equals what we store.
"""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError


class DuplicatePartNumber(Exception):
    """part_number already exists for this org."""


class BadLocations(Exception):
    """locations payload isn't a list of {location, qty, avg_cost, value}."""


def _num(v) -> Optional[float]:
    return float(v) if v is not None else None


def normalize_locations(raw: Any) -> list[dict[str, Any]]:
    """Validate a locations payload, drop blank-named rows, recompute each value."""
    from .contract import PartLocation

    if raw is None:
        return []
    if not isinstance(raw, list):
        raise BadLocations("locations must be a list")
    try:
        parsed = [PartLocation.model_validate(x) for x in raw]
    except Exception as e:
        raise BadLocations(str(e)) from e
    out: list[dict[str, Any]] = []
    for loc in parsed:
        if not loc.location.strip():
            continue
        value = round(loc.qty * loc.avg_cost, 2) if loc.avg_cost is not None else None
        out.append(
            {
                "location": loc.location.strip(),
                "qty": loc.qty,
                "avg_cost": loc.avg_cost,
                "value": value,
            }
        )
    return out


def derive_totals(
    locations: list[dict[str, Any]],
    qty_on_hand: int,
    avg_cost: Optional[float],
) -> tuple[int, Optional[float], Optional[float]]:
    """Item-level (qty, avg_cost, on_hand_value) for a part.

    With locations the three are derived and the caller's qty/avg_cost are
    ignored: the ledger carries a different avg cost per location, so the item
    avg is the *weighted* average (total value / total qty) — the only definition
    where value stays both the sum of location values and qty * avg_cost.
    Without locations they're author-owned and only value is derived.
    """
    if locations:
        qty = int(round(sum(loc["qty"] for loc in locations)))
        vals = [
            loc["qty"] * loc["avg_cost"]
            for loc in locations
            if loc.get("avg_cost") is not None
        ]
        value = round(sum(vals), 2) if vals else None
        avg = round(value / qty, 4) if (value is not None and qty > 0) else None
        return qty, avg, value
    value = round(qty_on_hand * avg_cost, 2) if avg_cost is not None else None
    return qty_on_hand, avg_cost, value


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
    locations: Optional[list[dict[str, Any]]] = None,
    department: Optional[str] = None,
    subsidiary: Optional[str] = None,
    inv_class: Optional[str] = None,
) -> dict[str, Any]:
    from .db import session_scope

    locs = normalize_locations(locations)
    qty_on_hand, avg_cost, on_hand_value = derive_totals(locs, qty_on_hand, avg_cost)

    stmt = text(
        """
        INSERT INTO parts (org_id, part_number, name, description, compatible_units,
                           bin_location, qty_on_hand, supplier, lead_time_days,
                           alternate_part_numbers, avg_cost, on_hand_value, locations,
                           department, subsidiary, inv_class)
        VALUES (:org, :pn, :name, :desc, :cu, :bin, :qty, :sup, :lead, :alt, :cost,
                :val, :locs, :dept, :sub, :cls)
        RETURNING *
        """
    ).bindparams(
        bindparam("cu", type_=JSONB),
        bindparam("alt", type_=JSONB),
        bindparam("locs", type_=JSONB),
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
        "val": on_hand_value,
        "locs": locs,
        "dept": department,
        "sub": subsidiary,
        "cls": inv_class,
    }
    try:
        async with session_scope() as session:
            row = (await session.execute(stmt, params)).mappings().first()
    except IntegrityError as e:
        raise DuplicatePartNumber(part_number) from e
    return _row_to_part(row)
