"""Export the live Supabase domain data to JSON snapshots.

Supabase is the source of truth. This dumps assets, parts, and corpus_chunks
(text + scope, WITHOUT embeddings — corpus_build re-embeds on load) so a fresh
project can be repopulated and the demo can be reset, without the hand-authored
seed files being canonical.

  python -m scripts.export_supabase            # writes to seeds/_snapshot/
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from sqlalchemy import text

from railio.db import close_engine, session_scope

if os.environ.get("DATABASE_URL_DIRECT"):
    os.environ["DATABASE_URL"] = os.environ["DATABASE_URL_DIRECT"]

OUT = Path(__file__).resolve().parent.parent / "seeds" / "_snapshot"


async def _rows(sql: str) -> list[dict]:
    async with session_scope() as s:
        res = await s.execute(text(sql))
        return [dict(r) for r in res.mappings().all()]


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    assets = await _rows(
        "SELECT reporting_mark, road_number, unit_model, in_service_date, "
        "last_inspection_at FROM assets ORDER BY id"
    )
    parts = await _rows(
        "SELECT part_number, name, description, compatible_units, bin_location, "
        "qty_on_hand, supplier, lead_time_days, alternate_part_numbers, last_used_at "
        "FROM parts ORDER BY id"
    )
    # Embeddings deliberately omitted — corpus_build re-embeds. Keep scope so the
    # snapshot round-trips per-unit tagging.
    corpus = await _rows(
        "SELECT doc_class, doc_id, doc_title, source_label, page, text, "
        "unit_model, asset_id FROM corpus_chunks ORDER BY id"
    )

    (OUT / "assets.json").write_text(json.dumps(assets, indent=2), "utf-8")
    (OUT / "parts.json").write_text(json.dumps(parts, indent=2), "utf-8")
    (OUT / "corpus_chunks.json").write_text(json.dumps(corpus, indent=2), "utf-8")

    print(
        f"export: {len(assets)} assets, {len(parts)} parts, {len(corpus)} corpus chunks "
        f"-> {OUT}"
    )
    await close_engine()


if __name__ == "__main__":
    asyncio.run(main())
