"""Upload figure PNGs to the prod Supabase storage bucket.

Mirrors backend/railio/storage.py: same bucket and the same /api/uploads/<key>
relative-URL convention, so the figure `path` stored on a chunk resolves through
the backend's existing signed-URL redirect when the website later renders it.
"""

from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from .config import get_settings

STORAGE_BUCKET = "railio-uploads"
STORAGE_URL_PREFIX = "/api/uploads"


@lru_cache(maxsize=1)
def _client() -> Client:
    s = get_settings()
    if not s.supabase_url or not s.supabase_service_role_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required")
    return create_client(s.supabase_url, s.supabase_service_role_key)


def upload_figure(storage_key: str, body: bytes) -> str:
    """Upload a PNG and return the backend-relative URL (/api/uploads/<key>)."""
    _client().storage.from_(STORAGE_BUCKET).upload(
        path=storage_key,
        file=body,
        file_options={"content-type": "image/png", "upsert": "true"},
    )
    return f"{STORAGE_URL_PREFIX}/{storage_key}"


def upload_pdf(storage_key: str, body: bytes) -> str:
    """Upload the source PDF and return its storage key (what documents.pdf_path
    stores). Served inline by the backend so the browser viewer honors #page=N."""
    _client().storage.from_(STORAGE_BUCKET).upload(
        path=storage_key,
        file=body,
        file_options={"content-type": "application/pdf", "upsert": "true"},
    )
    return storage_key
