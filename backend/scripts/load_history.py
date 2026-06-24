"""Replace ONE org's per-unit historical records without touching its other data.

Unlike load_org (which wipes the whole org's assets/parts/corpus and reloads from
disk), this only refreshes historical_records + their embedded history_* corpus
chunks for the units named in org-data/<slug>/history.json. Use it when the parts
ledger / assets already live in Supabase and must be preserved.

Usage:
    python -m scripts.load_history <slug>
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

import railio.config  # noqa: F401  (loads .env)
from sqlalchemy import text

from railio.assets_repo import list_assets
from railio.contract import HistoricalTest
from railio.db import close_engine, get_engine, session_scope
from railio.historical_repo import create_historical_record

if os.environ.get("DATABASE_URL_DIRECT"):
    os.environ["DATABASE_URL"] = os.environ["DATABASE_URL_DIRECT"]

ORG_DATA = Path(__file__).resolve().parent.parent / "org-data"


async def main() -> None:
    if len(sys.argv) < 2:
        print("usage: python -m scripts.load_history <slug>")
        raise SystemExit(2)
    slug = sys.argv[1].strip()
    hist_path = ORG_DATA / slug / "history.json"
    if not hist_path.exists():
        print(f"load_history: no history.json at {hist_path}")
        raise SystemExit(1)
    history: dict[str, list[dict[str, Any]]] = json.loads(hist_path.read_text("utf-8"))

    engine = get_engine()
    async with engine.begin() as conn:
        org_id = (
            await conn.execute(
                text("SELECT id FROM organizations WHERE slug = :slug"), {"slug": slug}
            )
        ).scalar_one()

    assets = await list_assets(org_id)
    by_road = {a.road_number: a for a in assets}

    total = 0
    for road_number, records in history.items():
        asset = by_road.get(str(road_number))
        if not asset:
            print(f"load_history[{slug}]: road {road_number} has no asset — skipped")
            continue
        # Wipe this unit's existing structured history + its embedded corpus chunks
        # (history_* doc_ids), leaving parts / other corpus untouched.
        async with session_scope() as session:
            await session.execute(
                text(
                    "DELETE FROM corpus_chunks WHERE org_id = :o AND asset_id = :a "
                    "AND doc_id LIKE 'history\\_%' ESCAPE '\\'"
                ),
                {"o": org_id, "a": asset.id},
            )
            await session.execute(
                text("DELETE FROM historical_records WHERE org_id = :o AND asset_id = :a"),
                {"o": org_id, "a": asset.id},
            )
        for rec in records:
            await create_historical_record(
                asset,
                reported_date=rec.get("reported_date"),
                completed_date=rec.get("completed_date"),
                record_type=rec.get("record_type"),
                repairs=rec.get("repairs") or [],
                tests=[HistoricalTest(**t) for t in (rec.get("tests") or [])],
                technician=rec.get("technician"),
                notes=rec.get("notes"),
            )
            total += 1
        print(f"load_history[{slug}]: {asset.reporting_mark} {asset.road_number} — {len(records)} records")

    print(f"load_history[{slug}]: ok — {total} records loaded")
    await close_engine()


if __name__ == "__main__":
    asyncio.run(main())
