"""Assets (locomotive roster) CRUD + document attachment."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from ..assets_repo import attach_document, create_asset, list_assets
from ..contract import AttachDocumentBody, CreateAssetBody, Organization
from ..org_context import get_current_org

router = APIRouter()


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
    assets = await list_assets(org.id)
    asset = next((a for a in assets if a.id == asset_id), None)
    if not asset:
        raise HTTPException(status_code=404, detail="asset not found")
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
