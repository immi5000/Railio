"""Assets (locomotive roster) CRUD + document attachment."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from ..assets_repo import attach_document, create_asset, list_assets
from ..contract import (
    AttachDocumentBody,
    CreateAssetBody,
    CreateHistoricalRecordBody,
    Organization,
)
from ..historical_repo import (
    create_historical_record,
    get_historical_record,
    list_historical_records,
    update_historical_record,
)
from ..org_context import get_current_org

router = APIRouter()


async def _require_asset(asset_id: int, org_id: int):
    assets = await list_assets(org_id)
    asset = next((a for a in assets if a.id == asset_id), None)
    if not asset:
        raise HTTPException(status_code=404, detail="asset not found")
    return asset


@router.get("")
async def get_assets(org: Organization = Depends(get_current_org)) -> JSONResponse:
    assets = await list_assets(org.id)
    return JSONResponse([a.model_dump() for a in assets])


@router.post("")
async def post_asset(
    body: CreateAssetBody, org: Organization = Depends(get_current_org)
) -> JSONResponse:
    asset = await create_asset(
        org_id=org.id,
        reporting_mark=body.reporting_mark,
        road_number=body.road_number,
        unit_model=body.unit_model,
        in_service_date=body.in_service_date,
        last_inspection_at=body.last_inspection_at,
    )
    return JSONResponse(asset.model_dump())


@router.post("/{asset_id}/documents")
async def post_asset_document(
    asset_id: int,
    body: AttachDocumentBody,
    org: Organization = Depends(get_current_org),
) -> JSONResponse:
    asset = await _require_asset(asset_id, org.id)
    chunk_id = await attach_document(
        asset,
        doc_class=body.doc_class,
        doc_title=body.doc_title,
        source_label=body.source_label,
        text_body=body.text,
        unit_specific=body.unit_specific,
        page=body.page,
    )
    if chunk_id is None:
        raise HTTPException(status_code=502, detail="embedding failed")
    return JSONResponse({"chunk_id": chunk_id})


@router.get("/{asset_id}/history")
async def get_asset_history(
    asset_id: int, org: Organization = Depends(get_current_org)
) -> JSONResponse:
    await _require_asset(asset_id, org.id)
    records = await list_historical_records(org.id, asset_id)
    return JSONResponse([r.model_dump() for r in records])


@router.post("/{asset_id}/history")
async def post_asset_history(
    asset_id: int,
    body: CreateHistoricalRecordBody,
    org: Organization = Depends(get_current_org),
) -> JSONResponse:
    asset = await _require_asset(asset_id, org.id)
    rec = await create_historical_record(
        asset,
        reported_date=body.reported_date,
        completed_date=body.completed_date,
        record_type=body.record_type,
        repairs=body.repairs,
        tests=body.tests,
        technician=body.technician,
    )
    return JSONResponse(rec.model_dump())


@router.patch("/{asset_id}/history/{record_id}")
async def patch_asset_history(
    asset_id: int,
    record_id: int,
    body: CreateHistoricalRecordBody,
    org: Organization = Depends(get_current_org),
) -> JSONResponse:
    asset = await _require_asset(asset_id, org.id)
    existing = await get_historical_record(org.id, record_id)
    if existing is None or existing.asset_id != asset_id:
        raise HTTPException(status_code=404, detail="record not found")
    rec = await update_historical_record(
        asset,
        record_id,
        reported_date=body.reported_date,
        completed_date=body.completed_date,
        record_type=body.record_type,
        repairs=body.repairs,
        tests=body.tests,
        technician=body.technician,
    )
    return JSONResponse(rec.model_dump())
