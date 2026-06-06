"""Seed assets + parts + demo tickets from backend/seeds/."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from railio.db import close_engine, get_engine, session_scope
from railio.tickets_repo import create_ticket

if os.environ.get("DATABASE_URL_DIRECT"):
    os.environ["DATABASE_URL"] = os.environ["DATABASE_URL_DIRECT"]

SEEDS = Path(__file__).resolve().parent.parent / "seeds"


async def main() -> None:
    engine = get_engine()
    assets = json.loads((SEEDS / "assets.json").read_text("utf-8"))
    parts = json.loads((SEEDS / "parts.json").read_text("utf-8"))
    demo = json.loads((SEEDS / "demo-tickets.json").read_text("utf-8"))

    async with engine.begin() as conn:
        for stmt in (
            "DELETE FROM ticket_parts",
            "DELETE FROM tribal_capture",
            "DELETE FROM messages",
            "DELETE FROM tickets",
            "DELETE FROM parts",
            # corpus_chunks.asset_id FKs assets — clear the refs before deleting
            # assets. corpus_build fully rebuilds corpus_chunks afterward.
            "UPDATE corpus_chunks SET asset_id = NULL",
            "DELETE FROM assets",
        ):
            await conn.execute(text(stmt))
        for t in ("assets", "parts", "tickets", "messages", "ticket_parts"):
            await conn.execute(
                text("SELECT setval(pg_get_serial_sequence(:t, 'id'), 1, false)"),
                {"t": t},
            )

        for a in assets:
            await conn.execute(
                text(
                    """
                    INSERT INTO assets (
                        reporting_mark, road_number, unit_model,
                        in_service_date, last_inspection_at
                    )
                    VALUES (:rm, :rn, :um, :in_svc, :last)
                    """
                ),
                {
                    "rm": a["reporting_mark"],
                    "rn": a["road_number"],
                    "um": a["unit_model"],
                    "in_svc": a.get("in_service_date"),
                    "last": a.get("last_inspection_at"),
                },
            )

        ins_part = (
            text(
                """
                INSERT INTO parts (
                    part_number, name, description, compatible_units,
                    bin_location, qty_on_hand, supplier, lead_time_days,
                    alternate_part_numbers, last_used_at
                )
                VALUES (
                    :part_number, :name, :description, :compatible_units,
                    :bin_location, :qty_on_hand, :supplier, :lead_time_days,
                    :alternate_part_numbers, :last_used_at
                )
                """
            )
            .bindparams(
                bindparam("compatible_units", type_=JSONB),
                bindparam("alternate_part_numbers", type_=JSONB),
            )
        )
        for p in parts:
            await conn.execute(
                ins_part,
                {
                    "part_number": p["part_number"],
                    "name": p["name"],
                    "description": p.get("description"),
                    "compatible_units": p["compatible_units"],
                    "bin_location": p["bin_location"],
                    "qty_on_hand": int(p["qty_on_hand"]),
                    "supplier": p.get("supplier"),
                    "lead_time_days": p.get("lead_time_days"),
                    "alternate_part_numbers": p.get("alternate_part_numbers") or [],
                    "last_used_at": p.get("last_used_at"),
                },
            )

    print(f"seed: {len(assets)} assets, {len(parts)} parts.")

    for t in demo:
        async with session_scope() as session:
            row = (
                await session.execute(
                    text(
                        "SELECT id FROM assets WHERE reporting_mark = :rm AND road_number = :rn"
                    ),
                    {"rm": t["reporting_mark"], "rn": t["road_number"]},
                )
            ).mappings().first()
        if not row:
            print(
                f"seed: skipping demo ticket '{t['label']}' — asset {t['reporting_mark']} "
                f"{t['road_number']} not found"
            )
            continue
        created = await create_ticket(
            asset_id=row["id"],
            initial_symptoms=t.get("initial_symptoms"),
            initial_error_codes=t.get("initial_error_codes"),
            fault_dump_raw=t.get("fault_dump_raw"),
            severity=t.get("severity"),
        )
        print(f"seed: demo ticket #{created.id} ({t['label']})")

    print("seed: ok. Run `python -m scripts.corpus_build` to embed and load corpus.")
    await close_engine()


if __name__ == "__main__":
    asyncio.run(main())
