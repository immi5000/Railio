"""Reset the database to a clean, demo-free baseline.

This is NOT a demo seeder anymore. It wipes all org-private data (tickets,
messages, parts, assets, captures, and org-private corpus chunks) so the system
starts empty. Real tenants and their data are loaded per-org via
`python -m scripts.load_org <slug>`. Shared CFR corpus is left untouched here and
(re)built by `python -m scripts.corpus_build`.

Run order for a fresh environment:
    python -m scripts.migrate
    python -m scripts.corpus_build          # shared CFR (org_id = NULL)
    python -m scripts.load_org <org-slug>   # one per company you onboard
"""

from __future__ import annotations

import asyncio
import os

from sqlalchemy import text

from railio.db import close_engine, get_engine

if os.environ.get("DATABASE_URL_DIRECT"):
    os.environ["DATABASE_URL"] = os.environ["DATABASE_URL_DIRECT"]


async def main() -> None:
    engine = get_engine()
    async with engine.begin() as conn:
        for stmt in (
            "DELETE FROM ticket_parts",
            "DELETE FROM tribal_capture",
            "DELETE FROM messages",
            "DELETE FROM tickets",
            "DELETE FROM parts",
            # Drop any unit-specific corpus (it FKs assets via asset_id) — this
            # covers both new org-private chunks and stale chunks left from an old
            # build that predate org_id (those have org_id NULL but a real
            # asset_id). CFR chunks never have an asset_id, so they survive.
            "DELETE FROM corpus_chunks WHERE org_id IS NOT NULL OR asset_id IS NOT NULL",
            "DELETE FROM assets",
            "DELETE FROM organizations",
        ):
            await conn.execute(text(stmt))
        for t in ("assets", "parts", "tickets", "messages", "ticket_parts", "organizations"):
            await conn.execute(
                text("SELECT setval(pg_get_serial_sequence(:t, 'id'), 1, false)"),
                {"t": t},
            )

    print("seed: ok. Database reset to a clean baseline (no orgs, no demo data).")
    print("seed: run `python -m scripts.corpus_build` for shared CFR, then")
    print("seed: `python -m scripts.load_org <slug>` for each company.")
    await close_engine()


if __name__ == "__main__":
    asyncio.run(main())
