"""Photo upload route — multipart/form-data."""

from __future__ import annotations

import os
import time
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from ..contract import Attachment, Organization
from ..org_context import get_current_org
from ..storage import upload_to_bucket
from ..tickets_repo import get_ticket

router = APIRouter()


def _guess_mime(ext: str) -> str:
    ext = ext.lower()
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".pdf": "application/pdf",
    }.get(ext, "application/octet-stream")


@router.post("/{ticket_id}/photos")
async def upload_photos(
    ticket_id: int,
    files: list[UploadFile] = File(...),
    org: Organization = Depends(get_current_org),
) -> JSONResponse:
    if not files:
        raise HTTPException(status_code=400, detail="no files")
    if not await get_ticket(ticket_id, org.id):
        raise HTTPException(status_code=404, detail="ticket not found")
    attachments: list[Attachment] = []
    for f in files:
        if not f.filename:
            continue
        ext = os.path.splitext(f.filename)[1].lower()
        filename = f"{int(time.time() * 1000)}-{uuid.uuid4()}{ext}"
        storage_key = f"{ticket_id}/{filename}"
        body = await f.read()
        mime = f.content_type or _guess_mime(ext)
        path = upload_to_bucket(storage_key, body, mime)
        kind = "pdf" if mime == "application/pdf" else "image"
        attachments.append(Attachment(kind=kind, path=path, mime=mime))  # type: ignore[arg-type]
    return JSONResponse({"attachments": [a.model_dump() for a in attachments]})
