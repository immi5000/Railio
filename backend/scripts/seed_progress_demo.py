"""Seed 4 fresh AWAITING_TECH tickets for the Progress Rail demo org.

Tickets are intentionally not part of `load_org`, so this one-off script creates
them via the same `create_ticket()` path real dispatcher intake uses (which also
drafts each ticket's pre-arrival brief via OpenAI — best-effort).

Run after `python -m scripts.load_org progress-rail`:
    python -m scripts.seed_progress_demo

OPENAI_API_KEY should be set (backend/.env) for the pre-arrival summaries; ticket
creation still succeeds without it.
"""

from __future__ import annotations

import asyncio
import os

from sqlalchemy import text

from railio.db import close_engine, get_engine
from railio.tickets_repo import create_ticket

if os.environ.get("DATABASE_URL_DIRECT"):
    os.environ["DATABASE_URL"] = os.environ["DATABASE_URL_DIRECT"]

SLUG = "progress-rail"

# GP39-2-appropriate intake scenarios the EMD GP39-2 Operator's Manual can speak to.
TICKETS = [
    {
        "initial_symptoms": "Unit won't load past notch 4 — load regulator hunting, amps surge then drop.",
        "initial_error_codes": "LOAD-REG",
        "fault_dump_raw": (
            "2026-06-17 07:42:11 LOAD-REG WARN load regulator oscillating in notch 5\n"
            "2026-06-17 07:42:11 PWR-LIMIT main gen output capped ~1800A"
        ),
        "severity": "major",
    },
    {
        "initial_symptoms": "No dynamic braking on the lead unit — grid blower not spinning up on setup.",
        "initial_error_codes": "DB-FAULT",
        "fault_dump_raw": (
            "2026-06-17 09:15:03 DB-FAULT MAJOR dynamic brake not establishing\n"
            "2026-06-17 09:15:03 GRID-BLWR no feedback from braking grid blower"
        ),
        "severity": "major",
    },
    {
        "initial_symptoms": "Engine cranks but won't fire — suspect governor low-oil trip / lockout.",
        "initial_error_codes": "NO-START",
        "fault_dump_raw": (
            "2026-06-17 06:03:47 NO-START engine cranks, no combustion\n"
            "2026-06-17 06:03:47 GOV-LOP low oil pressure trip armed at start"
        ),
        "severity": "critical",
    },
    {
        "initial_symptoms": "Slow brake pipe charge — suspect leak around the 26-L brake stand.",
        "initial_error_codes": None,
        "fault_dump_raw": (
            "2026-06-17 11:28:30 BP-CHARGE brake pipe slow to charge to 90 psi\n"
            "2026-06-17 11:28:30 AIR-LEAK estimated leak rate elevated"
        ),
        "severity": "major",
    },
]


async def main() -> None:
    engine = get_engine()
    async with engine.connect() as conn:
        row = (
            await conn.execute(
                text(
                    """
                    SELECT a.id AS asset_id, a.org_id AS org_id
                    FROM assets a
                    JOIN organizations o ON o.id = a.org_id
                    WHERE o.slug = :slug AND a.unit_model = 'EMD GP39-2'
                    ORDER BY a.id
                    LIMIT 1
                    """
                ),
                {"slug": SLUG},
            )
        ).mappings().first()

    if not row:
        print(
            f"seed_progress_demo: no 'EMD GP39-2' asset for org '{SLUG}'. "
            f"Run `python -m scripts.load_org {SLUG}` first."
        )
        await close_engine()
        raise SystemExit(1)

    asset_id, org_id = row["asset_id"], row["org_id"]
    print(f"seed_progress_demo: org #{org_id}, GP39-2 asset #{asset_id}")

    for i, t in enumerate(TICKETS, 1):
        ticket = await create_ticket(
            asset_id=asset_id,
            org_id=org_id,
            initial_symptoms=t["initial_symptoms"],
            initial_error_codes=t["initial_error_codes"],
            fault_dump_raw=t["fault_dump_raw"],
            severity=t["severity"],
        )
        print(f"  [{i}/{len(TICKETS)}] {ticket.short_id} — {ticket.title} ({ticket.severity})")

    print(f"seed_progress_demo: ok — {len(TICKETS)} tickets created.")
    await close_engine()


if __name__ == "__main__":
    asyncio.run(main())
