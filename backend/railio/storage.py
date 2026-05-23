"""Supabase Storage helpers."""

from __future__ import annotations

from functools import lru_cache
from typing import Optional

from supabase import Client, create_client

from .config import get_settings

STORAGE_BUCKET = "railio-uploads"
STORAGE_URL_PREFIX = "/api/uploads"


@lru_cache(maxsize=1)
def get_storage() -> Client:
    s = get_settings()
    if not s.supabase_url or not s.supabase_service_role_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required")
    return create_client(s.supabase_url, s.supabase_service_role_key)


def upload_to_bucket(storage_key: str, body: bytes, content_type: str) -> str:
    """Upload bytes and return the backend-relative URL the frontend can fetch."""
    res = get_storage().storage.from_(STORAGE_BUCKET).upload(
        path=storage_key,
        file=body,
        file_options={"content-type": content_type, "upsert": "true"},
    )
    # supabase-py returns an UploadResponse-ish object; treat absence of exception as success.
    _ = res
    return f"{STORAGE_URL_PREFIX}/{storage_key}"


def sign_storage_key(storage_key: str, expires_in: int = 60 * 60) -> str:
    res = get_storage().storage.from_(STORAGE_BUCKET).create_signed_url(storage_key, expires_in)
    # supabase-py returns {"signedURL": "..."} or {"signedUrl": "..."} depending on version.
    url: Optional[str] = res.get("signedURL") or res.get("signedUrl")  # type: ignore[union-attr]
    if not url:
        raise RuntimeError(f"storage sign failed: {res}")
    return url


def download_bytes(storage_key: str) -> Optional[bytes]:
    try:
        data = get_storage().storage.from_(STORAGE_BUCKET).download(storage_key)
        return bytes(data) if data else None
    except Exception:
        return None
