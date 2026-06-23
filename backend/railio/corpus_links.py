"""Resolve a corpus chunk (or document) to a deep link the UI can open.

Single source of truth for citation/document linking:
  - CFR (eCFR-sourced, no PDF) -> the official eCFR section page (exact section).
  - OEM manual (a stored PDF) -> /api/uploads/<pdf_path>#page=<n> so the browser's
    native viewer opens the right page (the #page fragment survives the uploads
    302 redirect to the signed URL).
  - Tribal / history / anything without a resolvable source -> None (the caller
    falls back to the in-app chunk drawer).

`source_url` is always COMPUTED here, never persisted — so the append-only
message hash chain is untouched.
"""

from __future__ import annotations

import re
from typing import Any, Optional

from .storage import STORAGE_URL_PREFIX

_CFR_DOC_ID = re.compile(r"^cfr_(\d+)_(\d+)")
# A section number like "229.5" or "232.105" (optionally a trailing letter).
_SECTION = re.compile(r"§\s*(\d+\.\d+[a-z]?)")


def _cfr_url(doc_id: str, source_label: str) -> Optional[str]:
    m = _CFR_DOC_ID.match(doc_id)
    if not m:
        return None
    title, part = m.group(1), m.group(2)
    base = f"https://www.ecfr.gov/current/title-{title}/part-{part}"
    sec = _SECTION.search(source_label or "")
    if sec:
        return f"{base}/section-{sec.group(1)}"
    return base


def resolve_source_url(chunk: dict[str, Any]) -> Optional[str]:
    """Deep link for a single chunk/citation, or None if it has no openable source."""
    doc_id = chunk.get("doc_id") or ""
    if doc_id.startswith("cfr_"):
        return _cfr_url(doc_id, chunk.get("source_label") or "")

    pdf_path = chunk.get("pdf_path")
    if pdf_path:
        page = chunk.get("pdf_page") or chunk.get("page") or 1
        key = pdf_path.lstrip("/")
        return f"{STORAGE_URL_PREFIX}/{key}#page={page}"

    return None


def resolve_document_url(doc: dict[str, Any]) -> Optional[str]:
    """Document-level link for the Knowledge view: the CFR part page or the PDF
    root (no page). Tribal/history docs have no source -> None (shown inline)."""
    doc_id = doc.get("doc_id") or ""
    if doc_id.startswith("cfr_"):
        m = _CFR_DOC_ID.match(doc_id)
        if not m:
            return None
        return f"https://www.ecfr.gov/current/title-{m.group(1)}/part-{m.group(2)}"

    pdf_path = doc.get("pdf_path")
    if pdf_path:
        return f"{STORAGE_URL_PREFIX}/{pdf_path.lstrip('/')}"
    return None
