"""CLI: ingest one OEM manual PDF as model-level (shared) corpus data.

    python -m railio_ingest.extract \
        --pdf path/to/SD60.pdf \
        --model "EMD SD60" \
        --doc-id emd_sd60_computer_troubleshooting \
        --doc-title "EMD SD60 Computer & Troubleshooting Guide" \
        [--oem "Electro-Motive Division"] [--dpi 300] [--dry-run] [--yes]

Writes shared-by-model data (org_id = NULL) directly to the prod Supabase:
models + documents + corpus_chunks (with embeddings + figures), and figure PNGs
to the storage bucket. --dry-run does extraction + writes artifacts to
out/<doc_id>/ and skips ALL DB/storage writes.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime
import json
import sys
from pathlib import Path
from typing import Any

from . import db, embeddings
from .config import get_settings
from .pipeline import Chunk, extract
from .storage import upload_figure


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds")


def _local_figure_writer(out_dir: Path):
    fig_dir = out_dir / "figures"
    fig_dir.mkdir(parents=True, exist_ok=True)

    def write(storage_key: str, png: bytes) -> str:
        # mirror the bucket key layout under out/<doc_id>/figures/
        name = storage_key.split("/")[-1]
        (fig_dir / name).write_bytes(png)
        return f"(dry-run) out/.../figures/{name}"

    return write


def _bucket_figure_writer():
    def write(storage_key: str, png: bytes) -> str:
        return upload_figure(storage_key, png)

    return write


def _chunks_preview(chunks: list[Chunk]) -> list[dict[str, Any]]:
    return [
        {
            "page_label": c.page_label,
            "page_num": c.page_num,
            "source_label": c.source_label,
            "text": c.text,
            "figures": c.figures,
        }
        for c in chunks
    ]


def _preflight(args: argparse.Namespace) -> Path:
    s = get_settings()
    s.require_openai()  # vision + embeddings both need it
    if not args.dry_run:
        s.require_db()
    pdf = Path(args.pdf)
    if not pdf.exists():
        sys.exit(f"PDF not found: {pdf}")
    return pdf


async def _write_to_db(
    args: argparse.Namespace, chunks: list[Chunk]
) -> None:
    now = _now()
    await db.run_migration()
    print("✓ schema ensured (models, documents, corpus_chunks additions, trgm index)")

    if not await db.model_exists(args.model):
        if not args.yes:
            ans = input(
                f'Model "{args.model}" does not exist. Create it? [y/N] '
            ).strip().lower()
            if ans != "y":
                sys.exit("Aborted — model not created.")
        print(f'• creating model "{args.model}"')
    model_id = await db.resolve_model(args.model, args.oem, now)

    unit_model = args.model
    document_id = await db.upsert_document(
        model_id=model_id,
        doc_id=args.doc_id,
        doc_title=args.doc_title,
        doc_class="manual",
        unit_model=unit_model,
        page_count=len(chunks),
        now=now,
    )
    removed = await db.delete_document_chunks(document_id)
    if removed:
        print(f"• replaced {removed} existing chunk(s) for this document")

    texts = [c.text for c in chunks]
    print(f"• embedding {len(texts)} chunk(s) (OpenAI 1024-dim)…")
    vectors = embeddings.embed_documents(texts)
    if len(vectors) != len(chunks):
        sys.exit("embedding count mismatch — aborting before write")

    rows = []
    for c, vec in zip(chunks, vectors):
        rows.append(
            {
                "doc_class": "manual",
                "doc_id": args.doc_id,
                "doc_title": args.doc_title,
                "source_label": c.source_label,
                "page": c.page_num,
                "text": c.text,
                "unit_model": unit_model,
                "embedding": embeddings.to_vector_literal(vec),
                "document_id": document_id,
                "model_id": model_id,
                "figures": json.dumps(c.figures) if c.figures else None,
            }
        )
    n = await db.insert_chunks(rows)
    total_figs = sum(len(c.figures) for c in chunks)
    print(
        f"✓ wrote {n} chunk(s) + {total_figs} figure(s) to prod as "
        f"model='{args.model}' (org_id=NULL, shared)."
    )


def main() -> None:
    p = argparse.ArgumentParser(prog="railio_ingest.extract")
    p.add_argument("--pdf", required=True)
    p.add_argument("--model", required=True, help='model_code, e.g. "EMD SD60"')
    p.add_argument("--doc-id", required=True)
    p.add_argument("--doc-title", required=True)
    p.add_argument("--oem", default=None, help="OEM name (stored on a new model row)")
    p.add_argument("--dpi", type=int, default=300)
    p.add_argument(
        "--max-pages",
        type=int,
        default=None,
        help="process only the first N PDF pages (for a cheap dry-run slice)",
    )
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--yes", action="store_true", help="don't prompt to create a model")
    args = p.parse_args()

    try:
        pdf = _preflight(args)
    except RuntimeError as e:
        sys.exit(str(e))

    out_dir = Path(__file__).resolve().parents[1] / "out" / args.doc_id
    if args.dry_run:
        writer = _local_figure_writer(out_dir)
    else:
        writer = _bucket_figure_writer()

    print(f"Extracting {pdf.name} → model '{args.model}' (doc_id={args.doc_id})")
    chunks = extract(
        str(pdf),
        doc_id=args.doc_id,
        doc_title=args.doc_title,
        figure_writer=writer,
        dpi=args.dpi,
        max_pages=args.max_pages,
    )
    print(
        f"Extracted {len(chunks)} chunk(s), "
        f"{sum(len(c.figures) for c in chunks)} figure(s)."
    )

    if args.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "chunks.json").write_text(
            json.dumps(_chunks_preview(chunks), indent=2)
        )
        print(f"✓ DRY RUN — artifacts in {out_dir} (chunks.json + figures/). No DB/storage writes.")
        return

    try:
        asyncio.run(_write_to_db(args, chunks))
    finally:
        asyncio.run(db.close_engine())


if __name__ == "__main__":
    main()
