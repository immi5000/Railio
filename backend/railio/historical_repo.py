"""Structured maintenance history per unit (Reported/Completed/Type/Repairs/
Tests/Technician).

This is the queryable, table-rendered record. Each row is also embedded into
corpus_chunks as a tribal_knowledge chunk scoped to the org + unit model + this
exact asset, so the copilot can cite a unit's maintenance history via
search_corpus — mirroring how finalize_wrap_up writes repair-history chunks.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from .contract import Asset, HistoricalRecord, HistoricalTest
from .corpus_repo import insert_corpus_chunk
from .db import session_scope
from .messages_repo import _iso_now


def _row_to_record(r: dict) -> HistoricalRecord:
    return HistoricalRecord(
        id=r["id"],
        org_id=r["org_id"],
        asset_id=r["asset_id"],
        reported_date=r["reported_date"],
        completed_date=r["completed_date"],
        record_type=r["record_type"],
        repairs=r["repairs"] or [],
        tests=[HistoricalTest(**t) for t in (r["tests"] or [])],
        technician=r["technician"],
        created_at=r["created_at"],
    )


async def list_historical_records(org_id: int, asset_id: int) -> list[HistoricalRecord]:
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT id, org_id, asset_id, reported_date, completed_date,
                           record_type, repairs, tests, technician, created_at
                    FROM historical_records
                    WHERE org_id = :org AND asset_id = :asset
                    ORDER BY reported_date DESC NULLS LAST, id DESC
                    """
                ),
                {"org": org_id, "asset": asset_id},
            )
        ).mappings().all()
    return [_row_to_record(r) for r in rows]


def _embed_text(asset: Asset, rec: HistoricalRecord) -> str:
    parts: list[str] = [
        f"Maintenance record for {asset.reporting_mark} {asset.unit_model} "
        f"{asset.road_number}.",
        f"Type: {rec.record_type or '—'}.",
        f"Reported: {rec.reported_date or '—'}. Completed: {rec.completed_date or '—'}.",
    ]
    if rec.repairs:
        parts.append("Repairs: " + "; ".join(rec.repairs) + ".")
    if rec.tests:
        parts.append(
            "Tests: "
            + "; ".join(
                f"{t.name}" + (f" ({t.date})" if t.date else "") for t in rec.tests
            )
            + "."
        )
    if rec.technician:
        parts.append(f"Technician: {rec.technician}.")
    return " ".join(parts)


def _source_label(asset: Asset, rec: HistoricalRecord) -> str:
    when = rec.completed_date or rec.reported_date or "—"
    kind = rec.record_type or "Maintenance"
    return (
        f"Maintenance Record — {asset.reporting_mark} {asset.unit_model} "
        f"{asset.road_number} — {kind} — {when}"
    )


async def create_historical_record(
    asset: Asset,
    *,
    reported_date: Optional[str] = None,
    completed_date: Optional[str] = None,
    record_type: Optional[str] = None,
    repairs: Optional[list[str]] = None,
    tests: Optional[list[HistoricalTest]] = None,
    technician: Optional[str] = None,
) -> HistoricalRecord:
    repairs = repairs or []
    tests = tests or []
    created_at = _iso_now()
    stmt = text(
        """
        INSERT INTO historical_records
            (org_id, asset_id, reported_date, completed_date, record_type,
             repairs, tests, technician, created_at)
        VALUES
            (:org, :asset, :reported, :completed, :rtype,
             :repairs, :tests, :tech, :at)
        RETURNING id, org_id, asset_id, reported_date, completed_date,
                  record_type, repairs, tests, technician, created_at
        """
    ).bindparams(bindparam("repairs", type_=JSONB), bindparam("tests", type_=JSONB))
    async with session_scope() as session:
        row = (
            await session.execute(
                stmt,
                {
                    "org": asset.org_id,
                    "asset": asset.id,
                    "reported": reported_date,
                    "completed": completed_date,
                    "rtype": record_type,
                    "repairs": repairs,
                    "tests": [t.model_dump() for t in tests],
                    "tech": technician,
                    "at": created_at,
                },
            )
        ).mappings().first()
    rec = _row_to_record(row)

    # Mirror into corpus so the copilot can cite this unit's maintenance history.
    doc_slug = f"{asset.reporting_mark}_{asset.road_number}".lower().replace(" ", "_")
    await insert_corpus_chunk(
        doc_class="tribal_knowledge",
        doc_id=f"history_{doc_slug}_{rec.id}",
        doc_title=f"Maintenance History — {asset.reporting_mark} "
        f"{asset.unit_model} {asset.road_number}",
        source_label=_source_label(asset, rec),
        text_body=_embed_text(asset, rec),
        org_id=asset.org_id,
        unit_model=asset.unit_model,
        asset_id=asset.id,
    )
    return rec
