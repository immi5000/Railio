"""Signed-URL redirect for uploaded files."""

from __future__ import annotations

from urllib.parse import unquote

from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse

from ..storage import sign_storage_key

router = APIRouter()


@router.get("/{key:path}")
async def get_upload(key: str) -> RedirectResponse:
    if not key:
        raise HTTPException(status_code=400, detail="missing key")
    storage_key = "/".join(unquote(p) for p in key.split("/"))
    try:
        signed = sign_storage_key(storage_key)
        return RedirectResponse(url=signed, status_code=302)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
