"""Assets (locomotive roster) repo + document attachment.

Assets are the fleet master list the dispatcher manages. Attaching a document
embeds it into the corpus scoped to the unit's model (and optionally this exact
road number), so the copilot grounds in the right docs per Phase 1 scoping.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import text

from .contract import Asset
from .corpus_repo import insert_corpus_chunk
from .db import session_scope
from .messages_repo import _iso_now


async def list_assets(org_id: Optional[int] = None) -> list[Asset]:
    where = " WHERE org_id = :org" if org_id is not None else ""
    params = {"org": org_id} if org_id is not None else {}
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    f"""
                    SELECT id, org_id, reporting_mark, road_number, unit_model,
                           in_service_date, last_inspection_at
                    FROM assets{where} ORDER BY reporting_mark, road_number
                    """
                ),
                params,
            )
        ).mappings().all()
    return [Asset(**r) for r in rows]


async def find_asset(
    reporting_mark: str, road_number: str, org_id: Optional[int] = None
) -> Optional[Asset]:
    # (reporting_mark, road_number) is no longer globally unique once multiple
    # orgs exist — the same road number can be owned by two railroads — so the
    # lookup key includes org_id.
    where = "reporting_mark = :rm AND road_number = :rn"
    params: dict[str, object] = {"rm": reporting_mark, "rn": road_number}
    if org_id is not None:
        where += " AND org_id = :org"
        params["org"] = org_id
    async with session_scope() as session:
        row = (
            await session.execute(
                text(
                    f"""
                    SELECT id, org_id, reporting_mark, road_number, unit_model,
                           in_service_date, last_inspection_at
                    FROM assets WHERE {where}
                    """
                ),
                params,
            )
        ).mappings().first()
    return Asset(**row) if row else None


async def create_asset(
    *,
    org_id: int,
    reporting_mark: str,
    road_number: str,
    unit_model: str,
    in_service_date: Optional[str] = None,
    last_inspection_at: Optional[str] = None,
) -> Asset:
    # Idempotent on (org_id, reporting_mark, road_number) — re-adding returns the
    # existing row rather than duplicating. Road numbers can collide across orgs,
    # so org_id is part of the key.
    existing = await find_asset(reporting_mark, road_number, org_id)
    if existing:
        return existing
    async with session_scope() as session:
        row = (
            await session.execute(
                text(
                    """
                    INSERT INTO assets (org_id, reporting_mark, road_number, unit_model,
                                        in_service_date, last_inspection_at)
                    VALUES (:org, :rm, :rn, :um, :in_svc, :last)
                    RETURNING id, org_id, reporting_mark, road_number, unit_model,
                              in_service_date, last_inspection_at
                    """
                ),
                {
                    "org": org_id,
                    "rm": reporting_mark,
                    "rn": road_number,
                    "um": unit_model,
                    "in_svc": in_service_date,
                    "last": last_inspection_at,
                },
            )
        ).mappings().first()
    return Asset(**row)


async def attach_document(
    asset: Asset,
    *,
    doc_class: str,
    doc_title: str,
    source_label: str,
    text_body: str,
    unit_specific: bool,
    page: Optional[int] = None,
) -> Optional[int]:
    """Embed a manual/history doc into the corpus, scoped to this asset/model."""
    slug = f"{asset.reporting_mark}_{asset.road_number}".lower().replace(" ", "_")
    doc_id = f"attached_{slug}_{_iso_now().replace(':', '').replace('-', '')[:15]}"
    return await insert_corpus_chunk(
        doc_class=doc_class,
        doc_id=doc_id,
        doc_title=doc_title,
        source_label=source_label,
        text_body=text_body,
        org_id=asset.org_id,
        unit_model=asset.unit_model,
        asset_id=asset.id if unit_specific else None,
        page=page,
    )
