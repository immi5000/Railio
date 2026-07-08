"""Assets (locomotive roster) repo + document attachment.

Assets are the fleet master list the dispatcher manages. Attaching a document
embeds it into the corpus scoped to the unit's model (and optionally this exact
road number), so the copilot grounds in the right docs per Phase 1 scoping.
"""

from __future__ import annotations

from datetime import date
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .contract import Asset, OosPeriod
from .corpus_repo import insert_corpus_chunk
from .db import session_scope
from .messages_repo import _iso_now

_ASSET_COLS = (
    "id, org_id, reporting_mark, road_number, unit_model, in_service_date, "
    "last_92_day_at, last_368_day_at, last_1104_day_at, out_of_service, oos_since"
)


async def _periods_for(
    session: AsyncSession, asset_ids: list[int]
) -> dict[int, list[OosPeriod]]:
    """One query for all periods of the given assets, grouped by asset_id."""
    grouped: dict[int, list[OosPeriod]] = {}
    if not asset_ids:
        return grouped
    rows = (
        await session.execute(
            text(
                """
                SELECT id, asset_id, started_at, ended_at
                FROM oos_periods WHERE asset_id = ANY(:ids)
                ORDER BY started_at, id
                """
            ),
            {"ids": asset_ids},
        )
    ).mappings().all()
    for r in rows:
        grouped.setdefault(r["asset_id"], []).append(OosPeriod(**r))
    return grouped


async def open_oos_period(
    session: AsyncSession, *, org_id: int, asset_id: int, started_at: str
) -> None:
    """Open an outage — no-op if one is already open for this asset."""
    await session.execute(
        text(
            """
            INSERT INTO oos_periods (org_id, asset_id, started_at, ended_at)
            SELECT :org, :aid, :start, NULL
            WHERE NOT EXISTS (
                SELECT 1 FROM oos_periods WHERE asset_id = :aid AND ended_at IS NULL
            )
            """
        ),
        {"org": org_id, "aid": asset_id, "start": started_at},
    )


async def close_open_oos_period(
    session: AsyncSession, *, org_id: int, asset_id: int, ended_at: str
) -> None:
    """Close whichever period is currently open for this asset (if any)."""
    await session.execute(
        text(
            """
            UPDATE oos_periods SET ended_at = :end
            WHERE asset_id = :aid AND org_id = :org AND ended_at IS NULL
            """
        ),
        {"org": org_id, "aid": asset_id, "end": ended_at},
    )


async def list_assets(org_id: Optional[int] = None) -> list[Asset]:
    where = " WHERE org_id = :org" if org_id is not None else ""
    params = {"org": org_id} if org_id is not None else {}
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    f"""
                    SELECT {_ASSET_COLS}
                    FROM assets{where} ORDER BY reporting_mark, road_number
                    """
                ),
                params,
            )
        ).mappings().all()
        periods = await _periods_for(session, [r["id"] for r in rows])
    return [Asset(**r, oos_periods=periods.get(r["id"], [])) for r in rows]


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
                text(f"SELECT {_ASSET_COLS} FROM assets WHERE {where}"),
                params,
            )
        ).mappings().first()
        if not row:
            return None
        periods = await _periods_for(session, [row["id"]])
    return Asset(**row, oos_periods=periods.get(row["id"], []))


async def create_asset(
    *,
    org_id: int,
    reporting_mark: str,
    road_number: str,
    unit_model: str,
    in_service_date: Optional[str] = None,
    last_92_day_at: Optional[str] = None,
    last_368_day_at: Optional[str] = None,
    last_1104_day_at: Optional[str] = None,
    out_of_service: bool = False,
    oos_since: Optional[str] = None,
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
                    f"""
                    INSERT INTO assets (org_id, reporting_mark, road_number, unit_model,
                                        in_service_date, last_92_day_at, last_368_day_at,
                                        last_1104_day_at, out_of_service, oos_since)
                    VALUES (:org, :rm, :rn, :um, :in_svc, :l92, :l368, :l1104, :oos, :oos_since)
                    RETURNING {_ASSET_COLS}
                    """
                ),
                {
                    "org": org_id,
                    "rm": reporting_mark,
                    "rn": road_number,
                    "um": unit_model,
                    "in_svc": in_service_date,
                    "l92": last_92_day_at,
                    "l368": last_368_day_at,
                    "l1104": last_1104_day_at,
                    "oos": out_of_service,
                    "oos_since": oos_since,
                },
            )
        ).mappings().first()
        # Created already down → open its first outage in the same transaction.
        if out_of_service:
            await open_oos_period(
                session,
                org_id=org_id,
                asset_id=row["id"],
                started_at=oos_since or date.today().isoformat(),
            )
        periods = await _periods_for(session, [row["id"]])
    return Asset(**row, oos_periods=periods.get(row["id"], []))


async def update_asset(
    *,
    asset_id: int,
    org_id: int,
    reporting_mark: str,
    road_number: str,
    unit_model: str,
    in_service_date: Optional[str] = None,
    last_92_day_at: Optional[str] = None,
    last_368_day_at: Optional[str] = None,
    last_1104_day_at: Optional[str] = None,
    out_of_service: bool = False,
    oos_since: Optional[str] = None,
) -> Optional[Asset]:
    # Org-scoped: a cross-org asset_id matches no row and returns None (404 at
    # the router), so a tenant can never edit another org's unit.
    today = date.today().isoformat()
    async with session_scope() as session:
        # Lock the row and read the prior OOS state so we can detect the edge
        # (in↔out) — concurrent PATCHes serialize here and can't double-open.
        prev = (
            await session.execute(
                text(
                    "SELECT out_of_service, oos_since FROM assets "
                    "WHERE id = :id AND org_id = :org FOR UPDATE"
                ),
                {"id": asset_id, "org": org_id},
            )
        ).mappings().first()
        if not prev:
            return None
        row = (
            await session.execute(
                text(
                    f"""
                    UPDATE assets
                    SET reporting_mark = :rm, road_number = :rn, unit_model = :um,
                        in_service_date = :in_svc, last_92_day_at = :l92,
                        last_368_day_at = :l368, last_1104_day_at = :l1104,
                        out_of_service = :oos, oos_since = :oos_since
                    WHERE id = :id AND org_id = :org
                    RETURNING {_ASSET_COLS}
                    """
                ),
                {
                    "id": asset_id,
                    "org": org_id,
                    "rm": reporting_mark,
                    "rn": road_number,
                    "um": unit_model,
                    "in_svc": in_service_date,
                    "l92": last_92_day_at,
                    "l368": last_368_day_at,
                    "l1104": last_1104_day_at,
                    "oos": out_of_service,
                    "oos_since": oos_since,
                },
            )
        ).mappings().first()
        # Reconcile the outage log to the desired END STATE (not the edge): a unit
        # that is out_of_service must have exactly one open period, one that is in
        # service must have none open. This is idempotent and self-healing — it
        # fixes rows that drifted (backfill gaps, a missed edge, bad legacy data)
        # rather than only reacting to the in↔out transition, which could never
        # recover a unit stuck out-of-service with no period row.
        if out_of_service:
            # Ensure an open period exists (no-op if one already is), then keep its
            # start aligned to oos_since so editing the date shifts the outage.
            await open_oos_period(
                session,
                org_id=org_id,
                asset_id=asset_id,
                started_at=oos_since or today,
            )
            if oos_since:
                await session.execute(
                    text(
                        "UPDATE oos_periods SET started_at = :start "
                        "WHERE asset_id = :aid AND ended_at IS NULL"
                    ),
                    {"start": oos_since, "aid": asset_id},
                )
        else:
            # In service → close any period still open, as of today.
            await close_open_oos_period(
                session, org_id=org_id, asset_id=asset_id, ended_at=today
            )
        periods = await _periods_for(session, [asset_id])
    return Asset(**row, oos_periods=periods.get(asset_id, []))


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
