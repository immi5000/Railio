"""Create the Postgres schema + pgvector index.

Idempotent: safe to re-run. Uses CREATE TABLE IF NOT EXISTS where possible.
"""

from __future__ import annotations

import asyncio
import os

from sqlalchemy import text

from railio.db import close_engine, get_engine

# Use direct connection (5432) when available to avoid pooler statement timeout.
if os.environ.get("DATABASE_URL_DIRECT"):
    os.environ["DATABASE_URL"] = os.environ["DATABASE_URL_DIRECT"]


_STATEMENTS = [
    "CREATE EXTENSION IF NOT EXISTS vector",
    """
    CREATE TABLE IF NOT EXISTS assets (
        id serial PRIMARY KEY,
        reporting_mark text NOT NULL,
        road_number text NOT NULL,
        unit_model text NOT NULL,
        in_service_date text,
        last_inspection_at text
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS tickets (
        id serial PRIMARY KEY,
        asset_id integer REFERENCES assets(id),
        status text NOT NULL,
        severity text NOT NULL DEFAULT 'major',
        opened_by_role text NOT NULL,
        opened_at text NOT NULL,
        initial_error_codes text,
        initial_symptoms text,
        fault_dump_raw text,
        fault_dump_parsed text,
        pre_arrival_summary text,
        closed_at text
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS messages (
        id serial PRIMARY KEY,
        ticket_id integer REFERENCES tickets(id),
        role text NOT NULL,
        content text NOT NULL,
        citations jsonb,
        attachments jsonb,
        tool_calls jsonb,
        created_at text NOT NULL,
        prev_hash text,
        hash text NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_messages_ticket ON messages (ticket_id, id)",
    """
    CREATE TABLE IF NOT EXISTS parts (
        id serial PRIMARY KEY,
        part_number text NOT NULL UNIQUE,
        name text NOT NULL,
        description text,
        compatible_units jsonb NOT NULL,
        bin_location text NOT NULL,
        qty_on_hand integer NOT NULL,
        supplier text,
        lead_time_days integer,
        alternate_part_numbers jsonb,
        last_used_at text
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS ticket_parts (
        id serial PRIMARY KEY,
        ticket_id integer REFERENCES tickets(id),
        part_id integer REFERENCES parts(id),
        qty integer NOT NULL,
        added_via text NOT NULL,
        added_at text NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS forms (
        id serial PRIMARY KEY,
        ticket_id integer REFERENCES tickets(id),
        form_type text NOT NULL,
        payload jsonb NOT NULL,
        status text NOT NULL,
        pdf_path text,
        updated_at text NOT NULL
    )
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS forms_ticket_form_unique
    ON forms (ticket_id, form_type)
    """,
    """
    CREATE TABLE IF NOT EXISTS corpus_chunks (
        id serial PRIMARY KEY,
        doc_class text NOT NULL,
        doc_id text NOT NULL,
        doc_title text NOT NULL,
        source_label text NOT NULL,
        page integer,
        text text NOT NULL,
        embedding vector(1024)
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS corpus_chunks_embedding_hnsw
    ON corpus_chunks USING hnsw (embedding vector_l2_ops)
    """,
    """
    CREATE TABLE IF NOT EXISTS tribal_capture (
        id serial PRIMARY KEY,
        ticket_id integer REFERENCES tickets(id),
        author text,
        text text NOT NULL,
        captured_at text NOT NULL,
        promoted_chunk_id integer
    )
    """,
]


async def main() -> None:
    engine = get_engine()
    async with engine.begin() as conn:
        for stmt in _STATEMENTS:
            await conn.execute(text(stmt))
    await close_engine()
    print("migrate: ok")


if __name__ == "__main__":
    asyncio.run(main())
