"""Verify the messages hash chain."""

from __future__ import annotations

import asyncio
import os
import sys

from sqlalchemy import text

from railio.db import close_engine, get_engine
from railio.hash import chain_hash

if os.environ.get("DATABASE_URL_DIRECT"):
    os.environ["DATABASE_URL"] = os.environ["DATABASE_URL_DIRECT"]


async def main() -> None:
    ok = True
    engine = get_engine()
    async with engine.connect() as conn:
        tickets = (
            await conn.execute(text("SELECT id FROM tickets ORDER BY id"))
        ).mappings().all()
        for t in tickets:
            rows = (
                await conn.execute(
                    text(
                        """
                        SELECT id, ticket_id, role, content, citations, attachments,
                               tool_calls, created_at, prev_hash, hash
                        FROM messages WHERE ticket_id = :tid ORDER BY id ASC
                        """
                    ),
                    {"tid": t["id"]},
                )
            ).mappings().all()
            prev: str | None = None
            for r in rows:
                if r["prev_hash"] != prev:
                    print(f"ticket {t['id']} msg {r['id']}: prev_hash mismatch")
                    ok = False
                expected = chain_hash(
                    prev,
                    {
                        "ticket_id": r["ticket_id"],
                        "role": r["role"],
                        "content": r["content"],
                        "citations": r["citations"],
                        "attachments": r["attachments"],
                        "tool_calls": r["tool_calls"],
                        "created_at": r["created_at"],
                    },
                )
                if expected != r["hash"]:
                    print(f"ticket {t['id']} msg {r['id']}: hash mismatch")
                    ok = False
                prev = r["hash"]
    await close_engine()
    if ok:
        print("verify-chain: ok")
    else:
        sys.exit(2)


if __name__ == "__main__":
    asyncio.run(main())
