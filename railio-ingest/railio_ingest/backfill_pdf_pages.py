"""One-time backfill: give the two already-ingested OEM manuals an openable PDF
and a true per-chunk PDF page, WITHOUT re-running the expensive vision pipeline
and WITHOUT re-minting chunk ids (which would break existing persisted citations).

Per document:
  1. Upload the local source PDF -> documents.pdf_path.
  2. Re-render book-pages (native text only, cheap) to recompute each page's
     source_label exactly as ingest did, then UPDATE the matching chunk's
     pdf_page in place.

    python -m railio_ingest.backfill_pdf_pages \
        --pdf ./SD60_troubleshooting.pdf \
        --doc-id emd_sd60_computer_troubleshooting

Forward ingests populate pdf_path/pdf_page automatically; this is only for data
loaded before those columns existed.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from . import db
from .config import get_settings
from .layout import render_book_pages
from .pipeline import _printed_page_number
from .storage import upload_pdf


def _source_label(doc_title: str, native_text: str, pdf_page_human: int) -> str:
    """Identical to pipeline.extract's label so existing chunks match exactly."""
    printed = _printed_page_number(native_text)
    return (
        f"{doc_title} — p.{printed}"
        if printed
        else f"{doc_title} — PDF p.{pdf_page_human}"
    )


async def _run(pdf: Path, doc_id: str, dpi: int) -> None:
    await db.run_migration()  # ensure pdf_path / pdf_page columns exist
    doc = await db.get_document_by_doc_id(doc_id)
    if not doc:
        sys.exit(
            f'No documents row for doc_id="{doc_id}". Ingest the manual first '
            "with railio_ingest.extract."
        )

    pdf_key = f"manuals/{doc_id}/source.pdf"
    upload_pdf(pdf_key, pdf.read_bytes())
    await db.set_document_pdf_path(doc["id"], pdf_key)
    print(f"✓ uploaded PDF + set documents.pdf_path = {pdf_key}")

    # Low DPI is fine: we only use native text geometry (two-up split + page label).
    pages = render_book_pages(str(pdf), dpi=dpi)
    chunk_ids = await db.get_document_chunk_ids(doc["id"])

    # Exact path: chunks were inserted in render order, so when every rendered
    # book-page produced a chunk (counts match), the i-th chunk IS the i-th
    # book-page — map positionally to its physical PDF page. This is collision-
    # free and correct for two-up spreads (both halves of PDF page N → page N).
    if len(chunk_ids) == len(pages):
        pairs = [(cid, pages[i].pdf_index + 1) for i, cid in enumerate(chunk_ids)]
        updated = await db.set_chunk_pdf_pages(pairs)
        print(
            f"✓ positional map: set pdf_page on {updated}/{len(chunk_ids)} chunk(s) "
            f"({len(pages)} book-page(s))."
        )
        return

    # Fallback: counts differ (some pages skipped at ingest) — match by the
    # source_label ingest derived for each page.
    print(
        f"• counts differ (chunks={len(chunk_ids)}, book-pages={len(pages)}); "
        "matching by source_label instead of position."
    )
    mapping: dict[str, int] = {}
    for bp in pages:
        label = _source_label(doc["doc_title"], bp.native_text, bp.pdf_index + 1)
        mapping[label] = bp.pdf_index + 1
    updated = await db.backfill_chunk_pdf_pages(doc["id"], mapping)
    print(
        f"✓ label map: set pdf_page on {updated} chunk(s) "
        f"({len(mapping)} distinct label(s))."
    )
    if updated == 0:
        print(
            "⚠ 0 chunks updated — source_label format may have drifted; "
            "verify doc_title matches what was ingested."
        )


def main() -> None:
    p = argparse.ArgumentParser(prog="railio_ingest.backfill_pdf_pages")
    p.add_argument("--pdf", required=True)
    p.add_argument("--doc-id", required=True)
    p.add_argument("--dpi", type=int, default=72, help="render DPI (text-only; low is fine)")
    args = p.parse_args()

    get_settings().require_db()
    pdf = Path(args.pdf)
    if not pdf.exists():
        sys.exit(f"PDF not found: {pdf}")

    try:
        asyncio.run(_run(pdf, args.doc_id, args.dpi))
    finally:
        asyncio.run(db.close_engine())


if __name__ == "__main__":
    main()
