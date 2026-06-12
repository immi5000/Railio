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
    "DROP TABLE IF EXISTS forms",
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
    # Per-unit scoping (additive, nullable):
    #   unit_model null = shared across all models (e.g. generic CFR)
    #   asset_id   null = not specific to one road number (manual, CFR, cross-unit notes)
    "ALTER TABLE corpus_chunks ADD COLUMN IF NOT EXISTS unit_model text",
    "ALTER TABLE corpus_chunks ADD COLUMN IF NOT EXISTS asset_id integer REFERENCES assets(id)",
    """
    CREATE INDEX IF NOT EXISTS corpus_chunks_embedding_hnsw
    ON corpus_chunks USING hnsw (embedding vector_l2_ops)
    """,
    "CREATE INDEX IF NOT EXISTS idx_corpus_chunks_scope ON corpus_chunks (unit_model, asset_id)",
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
    # === Multi-tenancy (by organization) ===
    # An organization is a railroad tenant. Org-private data (assets, tickets,
    # parts inventory, tribal/repair history) is never visible to another org;
    # shared reference data (CFR) has org_id = NULL and is visible to all orgs.
    """
    CREATE TABLE IF NOT EXISTS organizations (
        id serial PRIMARY KEY,
        name text NOT NULL,
        slug text NOT NULL UNIQUE,
        created_at text NOT NULL DEFAULT (now()::text)
    )
    """,
    # assets.org_id — added nullable, backfilled, then tightened to NOT NULL.
    # A direct ADD COLUMN ... NOT NULL would fail on any pre-existing rows.
    "ALTER TABLE assets ADD COLUMN IF NOT EXISTS org_id integer REFERENCES organizations(id)",
    """
    UPDATE assets SET org_id = (
        SELECT id FROM organizations ORDER BY id LIMIT 1
    ) WHERE org_id IS NULL AND EXISTS (SELECT 1 FROM organizations)
    """,
    # tickets.org_id — denormalized copy of the asset's org (avoids a join on the
    # tenant filter for every list/get). Backfilled from the linked asset.
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS org_id integer REFERENCES organizations(id)",
    """
    UPDATE tickets t SET org_id = a.org_id
    FROM assets a WHERE t.asset_id = a.id AND t.org_id IS NULL
    """,
    # parts.org_id — inventory is org-exclusive (never shared across tenants).
    "ALTER TABLE parts ADD COLUMN IF NOT EXISTS org_id integer REFERENCES organizations(id)",
    # part_number is unique PER ORG, not globally — two railroads may stock the
    # same OEM part number. Drop the old global unique constraint; add a partial
    # unique index keyed on (org_id, part_number) for rows that have an org.
    "ALTER TABLE parts DROP CONSTRAINT IF EXISTS parts_part_number_key",
    # Older databases named the global unique constraint differently; drop that
    # variant too so part_number can be unique per org, not globally.
    "ALTER TABLE parts DROP CONSTRAINT IF EXISTS parts_part_number_unique",
    """
    CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_org_partnumber
    ON parts (org_id, part_number) WHERE org_id IS NOT NULL
    """,
    # corpus_chunks.org_id — NULLABLE on purpose: NULL = shared (CFR, visible to
    # all orgs); non-null = org-private. NOT backfilled — corpus_build rewrites it.
    "ALTER TABLE corpus_chunks ADD COLUMN IF NOT EXISTS org_id integer REFERENCES organizations(id)",
    "CREATE INDEX IF NOT EXISTS idx_assets_org ON assets (org_id)",
    "CREATE INDEX IF NOT EXISTS idx_tickets_org ON tickets (org_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_parts_org ON parts (org_id)",
    "CREATE INDEX IF NOT EXISTS idx_corpus_chunks_scope2 ON corpus_chunks (org_id, unit_model, asset_id)",
    # === Auth (Supabase) ===
    # One membership row per Supabase auth user, keyed on the JWT `sub`. Created
    # at first login by get_or_provision_user (domain-map / allowlist → org). This
    # is the source of truth for which org a request belongs to once auth is on.
    """
    CREATE TABLE IF NOT EXISTS app_users (
        id serial PRIMARY KEY,
        supabase_user_id text NOT NULL UNIQUE,
        email text NOT NULL,
        org_id integer NOT NULL REFERENCES organizations(id),
        created_at text NOT NULL DEFAULT (now()::text)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_app_users_org ON app_users (org_id)",
    # Domain → org rules. Add a row to onboard a company without a redeploy.
    # Unmapped company domains auto-create their own org at first login; public
    # email domains get a personal org named after the username.
    """
    CREATE TABLE IF NOT EXISTS org_domains (
        id serial PRIMARY KEY,
        domain text NOT NULL UNIQUE,
        org_id integer NOT NULL REFERENCES organizations(id)
    )
    """,
    # Seed the known company-domain rules (idempotent). Placeholder domains —
    # edit to the real ones, or just INSERT new rows in the Supabase editor.
    """
    INSERT INTO org_domains (domain, org_id)
    SELECT 'anacostia.com', id FROM organizations WHERE slug = 'anacostia'
    ON CONFLICT (domain) DO NOTHING
    """,
    """
    INSERT INTO org_domains (domain, org_id)
    SELECT 'omnitrax.com', id FROM organizations WHERE slug = 'omnitrax'
    ON CONFLICT (domain) DO NOTHING
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
