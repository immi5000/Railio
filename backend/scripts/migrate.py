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
        title text,
        short_id text,
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
    # Structured maintenance history per unit (Reported/Completed/Type/Repairs/
    # Tests/Technician). Distinct from the free-text repair-history corpus chunk:
    # this is the queryable, table-rendered record; each row is ALSO embedded into
    # corpus_chunks as tribal_knowledge so the copilot can cite it.
    """
    CREATE TABLE IF NOT EXISTS historical_records (
        id serial PRIMARY KEY,
        org_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        asset_id integer NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        reported_date text,
        completed_date text,
        record_type text,
        repairs jsonb,
        tests jsonb,
        technician text,
        created_at text NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_historical_records_asset ON historical_records (org_id, asset_id)",
    "ALTER TABLE historical_records ADD COLUMN IF NOT EXISTS notes text",
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
    # === Parts: external-ledger fields (NetSuite stock ledger) ===
    # compatible_units / bin_location are no longer required: ledger-ingested
    # inventory has no locomotive mapping and is stocked across many warehouses.
    "ALTER TABLE parts ALTER COLUMN compatible_units DROP NOT NULL",
    "ALTER TABLE parts ALTER COLUMN bin_location DROP NOT NULL",
    "ALTER TABLE parts ADD COLUMN IF NOT EXISTS avg_cost numeric",
    "ALTER TABLE parts ADD COLUMN IF NOT EXISTS on_hand_value numeric",
    "ALTER TABLE parts ADD COLUMN IF NOT EXISTS locations jsonb",
    "ALTER TABLE parts ADD COLUMN IF NOT EXISTS department text",
    "ALTER TABLE parts ADD COLUMN IF NOT EXISTS subsidiary text",
    "ALTER TABLE parts ADD COLUMN IF NOT EXISTS inv_class text",
    # === Assets: FRA periodic inspections (49 CFR §229.23) + out-of-service ===
    # The single last_inspection_at date is replaced by the three FRA periodic
    # intervals; next-due/overdue is computed (not stored). out_of_service +
    # oos_since track downtime so the fleet shows how long a unit has been down.
    "ALTER TABLE assets ADD COLUMN IF NOT EXISTS last_92_day_at text",
    "ALTER TABLE assets ADD COLUMN IF NOT EXISTS last_368_day_at text",
    "ALTER TABLE assets ADD COLUMN IF NOT EXISTS last_1104_day_at text",
    "ALTER TABLE assets ADD COLUMN IF NOT EXISTS out_of_service boolean NOT NULL DEFAULT false",
    "ALTER TABLE assets ADD COLUMN IF NOT EXISTS oos_since text",
    # Fold the old single inspection date into the 92-day baseline before dropping it.
    """
    UPDATE assets SET last_92_day_at = last_inspection_at
    WHERE last_92_day_at IS NULL AND last_inspection_at IS NOT NULL
    """,
    "ALTER TABLE assets DROP COLUMN IF EXISTS last_inspection_at",
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
    # === Onboarding: profile capture on app_users ===
    # org_id becomes NULLABLE: a user is authenticated before they pick/join an
    # org during onboarding. profile_completed gates access to the app.
    "ALTER TABLE app_users ALTER COLUMN org_id DROP NOT NULL",
    "ALTER TABLE app_users ADD COLUMN IF NOT EXISTS name text",
    "ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone text",
    "ALTER TABLE app_users ADD COLUMN IF NOT EXISTS profile_completed boolean NOT NULL DEFAULT false",
    "ALTER TABLE app_users ADD COLUMN IF NOT EXISTS onboarded_at text",
    # Existing users already have an org — treat them as onboarded so they're
    # never bounced into the new onboarding flow.
    "UPDATE app_users SET profile_completed = true WHERE org_id IS NOT NULL AND profile_completed = false",
    # === Secure org-join: invite codes ===
    # A code grants membership to exactly one org. The org a user joins is decided
    # by the backend (domain rule OR a valid code OR auto-create) — never trusted
    # from the client. code stored lowercased; expires_at is ISO-8601 UTC text.
    """
    CREATE TABLE IF NOT EXISTS org_invite_codes (
        id serial PRIMARY KEY,
        code text NOT NULL UNIQUE,
        org_id integer NOT NULL REFERENCES organizations(id),
        max_uses integer,
        used_count integer NOT NULL DEFAULT 0,
        expires_at text,
        created_at text NOT NULL DEFAULT (now()::text)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_org_invite_codes_org ON org_invite_codes (org_id)",
    # === Chat rate limiting ===
    # One row per accepted chat message, keyed on the JWT sub. The limiter counts
    # rows in a sliding window per user and prunes older rows on each check, so the
    # table stays small. No FK to app_users: the limiter keys on the raw token sub.
    """
    CREATE TABLE IF NOT EXISTS chat_rate_events (
        id serial PRIMARY KEY,
        supabase_user_id text NOT NULL,
        created_at text NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_rate_user_time ON chat_rate_events (supabase_user_id, created_at)",
    # Seed one code per existing org (idempotent). Edit / add rows in Supabase.
    """
    INSERT INTO org_invite_codes (code, org_id)
    SELECT 'test-join', id FROM organizations WHERE slug = 'test'
    ON CONFLICT (code) DO NOTHING
    """,
    """
    INSERT INTO org_invite_codes (code, org_id)
    SELECT 'anacostia-join', id FROM organizations WHERE slug = 'anacostia'
    ON CONFLICT (code) DO NOTHING
    """,
    """
    INSERT INTO org_invite_codes (code, org_id)
    SELECT 'omnitrax-join', id FROM organizations WHERE slug = 'omnitrax'
    ON CONFLICT (code) DO NOTHING
    """,
    """
    INSERT INTO org_invite_codes (code, org_id)
    SELECT 'progress-join', id FROM organizations WHERE slug = 'progress-rail'
    ON CONFLICT (code) DO NOTHING
    """,
    # === Tickets: human title + short public id (replaces the numeric #id in the UI) ===
    # short_id is the user-facing handle used for lookup/URLs; the numeric id stays
    # the internal PK + FK target (messages/ticket_parts/tribal_capture unchanged).
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS title text",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS short_id text",
    # Backfill short_id for any pre-existing tickets: 6 lowercased base32-ish chars
    # off md5(id+opened_at), unique by construction (id is unique). Only fills NULLs.
    """
    UPDATE tickets SET short_id =
        substr(translate(md5(id::text || opened_at), 'oil019', 'qkm234'), 1, 6)
    WHERE short_id IS NULL
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_short_id ON tickets (short_id)",
    # Backfill a readable title for pre-existing tickets from asset + symptoms.
    """
    UPDATE tickets t SET title =
        a.unit_model || ' — ' ||
        COALESCE(NULLIF(btrim(t.initial_symptoms), ''),
                 NULLIF(btrim(t.initial_error_codes), ''),
                 'Maintenance ticket')
    FROM assets a
    WHERE a.id = t.asset_id AND t.title IS NULL
    """,
    # === Cascade deletes from an organization ===
    # Rebuild every FK in the org's dependency graph with ON DELETE CASCADE so
    # deleting an organization removes all of its data (assets → their tickets →
    # messages/parts/captures, parts, corpus, memberships, domains, codes). The
    # FKs were originally created NO ACTION, which blocked org deletion.
    # Idempotent: drop the known constraint name, recreate it with CASCADE.
    # org_id → organizations
    "ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_org_id_fkey",
    "ALTER TABLE app_users ADD CONSTRAINT app_users_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE",
    "ALTER TABLE org_domains DROP CONSTRAINT IF EXISTS org_domains_org_id_fkey",
    "ALTER TABLE org_domains ADD CONSTRAINT org_domains_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE",
    "ALTER TABLE org_invite_codes DROP CONSTRAINT IF EXISTS org_invite_codes_org_id_fkey",
    "ALTER TABLE org_invite_codes ADD CONSTRAINT org_invite_codes_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE",
    "ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_org_id_fkey",
    "ALTER TABLE assets ADD CONSTRAINT assets_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE",
    "ALTER TABLE parts DROP CONSTRAINT IF EXISTS parts_org_id_fkey",
    "ALTER TABLE parts ADD CONSTRAINT parts_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE",
    "ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_org_id_fkey",
    "ALTER TABLE tickets ADD CONSTRAINT tickets_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE",
    "ALTER TABLE corpus_chunks DROP CONSTRAINT IF EXISTS corpus_chunks_org_id_fkey",
    "ALTER TABLE corpus_chunks ADD CONSTRAINT corpus_chunks_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE",
    # asset_id → assets (so an org's assets cascade into their dependents)
    "ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_asset_id_assets_id_fk",
    "ALTER TABLE tickets ADD CONSTRAINT tickets_asset_id_assets_id_fk FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE",
    "ALTER TABLE corpus_chunks DROP CONSTRAINT IF EXISTS corpus_chunks_asset_id_fkey",
    "ALTER TABLE corpus_chunks ADD CONSTRAINT corpus_chunks_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE",
    # ticket_id / part_id → tickets / parts
    "ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_ticket_id_tickets_id_fk",
    "ALTER TABLE messages ADD CONSTRAINT messages_ticket_id_tickets_id_fk FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE",
    "ALTER TABLE ticket_parts DROP CONSTRAINT IF EXISTS ticket_parts_ticket_id_tickets_id_fk",
    "ALTER TABLE ticket_parts ADD CONSTRAINT ticket_parts_ticket_id_tickets_id_fk FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE",
    "ALTER TABLE ticket_parts DROP CONSTRAINT IF EXISTS ticket_parts_part_id_parts_id_fk",
    "ALTER TABLE ticket_parts ADD CONSTRAINT ticket_parts_part_id_parts_id_fk FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE CASCADE",
    "ALTER TABLE tribal_capture DROP CONSTRAINT IF EXISTS tribal_capture_ticket_id_tickets_id_fk",
    "ALTER TABLE tribal_capture ADD CONSTRAINT tribal_capture_ticket_id_tickets_id_fk FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE",
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
