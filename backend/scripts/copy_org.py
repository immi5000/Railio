"""Copy one organization's private data into another organization.

Admin tool for cloning a tenant's live data (fleet, inventory, tickets, and
knowledge corpus) from a source org into a destination org — e.g. to give the
`test` org a realistic mirror of `omnitrax`:

    python -m scripts.copy_org omnitrax test

The destination is created if its slug doesn't exist yet, and its existing
org-private data is wiped first so the result is a clean 1:1 mirror. App users,
domain rules, and invite codes on the destination are left untouched, so people
already in the org keep their access.

What is copied (all integer PKs are remapped to the destination):
    assets → parts → historical_records → corpus_chunks (org-private only)
    → tickets (fresh short_id) → ticket_parts → tribal_capture

What is NOT copied: messages (ticket threads start empty), the shared CFR corpus
(org_id IS NULL — already visible to every org), and identity rows
(app_users / org_domains / org_invite_codes). Corpus embeddings are copied
verbatim (no re-embedding), so retrieval works immediately at no OpenAI cost.
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from railio.corpus_figures import figures_supported, unit_models_supported
from railio.db import close_engine, get_engine
from railio.messages_repo import _iso_now
from railio.tickets_repo import _gen_short_id

if os.environ.get("DATABASE_URL_DIRECT"):
    os.environ["DATABASE_URL"] = os.environ["DATABASE_URL_DIRECT"]


async def main() -> None:
    if len(sys.argv) < 3:
        print("usage: python -m scripts.copy_org <source-slug> <dest-slug>")
        raise SystemExit(2)
    src_slug = sys.argv[1].strip()
    dest_slug = sys.argv[2].strip()
    if src_slug == dest_slug:
        print("copy_org: source and destination must differ")
        raise SystemExit(2)

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.execute(text("SET statement_timeout = '10min'"))

        # 1) Resolve source (must exist) + destination (upsert by slug).
        src = (
            await conn.execute(
                text("SELECT id, name FROM organizations WHERE slug = :s"),
                {"s": src_slug},
            )
        ).mappings().first()
        if not src:
            print(f"copy_org: source org '{src_slug}' not found")
            raise SystemExit(1)
        src_org = src["id"]

        dest_org = (
            await conn.execute(
                text(
                    """
                    INSERT INTO organizations (name, slug, created_at)
                    VALUES (:name, :slug, :at)
                    ON CONFLICT (slug) DO UPDATE SET name = organizations.name
                    RETURNING id
                    """
                ),
                {"name": src["name"], "slug": dest_slug, "at": _iso_now()},
            )
        ).scalar_one()

        # 2) Wipe the destination's existing private data (FK-safe order).
        for stmt in (
            "DELETE FROM ticket_parts WHERE ticket_id IN "
            "(SELECT id FROM tickets WHERE org_id = :org)",
            "DELETE FROM tribal_capture WHERE ticket_id IN "
            "(SELECT id FROM tickets WHERE org_id = :org)",
            "DELETE FROM messages WHERE ticket_id IN "
            "(SELECT id FROM tickets WHERE org_id = :org)",
            "DELETE FROM tickets WHERE org_id = :org",
            "DELETE FROM parts WHERE org_id = :org",
            "DELETE FROM corpus_chunks WHERE org_id = :org",
            "DELETE FROM historical_records WHERE org_id = :org",
            "DELETE FROM assets WHERE org_id = :org",
        ):
            await conn.execute(text(stmt), {"org": dest_org})

        # 3) Assets.
        asset_map: dict[int, int] = {}
        rows = (
            await conn.execute(
                text(
                    """
                    SELECT id, reporting_mark, road_number, unit_model, in_service_date,
                           last_92_day_at, last_368_day_at, last_1104_day_at,
                           out_of_service, oos_since
                    FROM assets WHERE org_id = :org ORDER BY id
                    """
                ),
                {"org": src_org},
            )
        ).mappings().all()
        for r in rows:
            new_id = (
                await conn.execute(
                    text(
                        """
                        INSERT INTO assets (org_id, reporting_mark, road_number, unit_model,
                                            in_service_date, last_92_day_at, last_368_day_at,
                                            last_1104_day_at, out_of_service, oos_since)
                        VALUES (:org, :rm, :rn, :um, :in_svc, :l92, :l368, :l1104, :oos, :oos_since)
                        RETURNING id
                        """
                    ),
                    {
                        "org": dest_org,
                        "rm": r["reporting_mark"],
                        "rn": r["road_number"],
                        "um": r["unit_model"],
                        "in_svc": r["in_service_date"],
                        "l92": r["last_92_day_at"],
                        "l368": r["last_368_day_at"],
                        "l1104": r["last_1104_day_at"],
                        "oos": r["out_of_service"],
                        "oos_since": r["oos_since"],
                    },
                )
            ).scalar_one()
            asset_map[r["id"]] = new_id

        # 4) Parts.
        part_map: dict[int, int] = {}
        ins_part = text(
            """
            INSERT INTO parts (
                org_id, part_number, name, description, compatible_units,
                bin_location, qty_on_hand, supplier, lead_time_days,
                alternate_part_numbers, last_used_at,
                avg_cost, on_hand_value, locations, department, subsidiary, inv_class
            )
            VALUES (
                :org, :part_number, :name, :description, :compatible_units,
                :bin_location, :qty_on_hand, :supplier, :lead_time_days,
                :alternate_part_numbers, :last_used_at,
                :avg_cost, :on_hand_value, :locations, :department, :subsidiary, :inv_class
            )
            RETURNING id
            """
        ).bindparams(
            bindparam("compatible_units", type_=JSONB),
            bindparam("alternate_part_numbers", type_=JSONB),
            bindparam("locations", type_=JSONB),
        )
        rows = (
            await conn.execute(
                text(
                    """
                    SELECT id, part_number, name, description, compatible_units, bin_location,
                           qty_on_hand, supplier, lead_time_days, alternate_part_numbers,
                           last_used_at, avg_cost, on_hand_value, locations, department,
                           subsidiary, inv_class
                    FROM parts WHERE org_id = :org ORDER BY id
                    """
                ),
                {"org": src_org},
            )
        ).mappings().all()
        for r in rows:
            new_id = (
                await conn.execute(
                    ins_part, {"org": dest_org, **{k: r[k] for k in r.keys() if k != "id"}}
                )
            ).scalar_one()
            part_map[r["id"]] = new_id

        # 5) Historical records.
        ins_hist = text(
            """
            INSERT INTO historical_records
                (org_id, asset_id, reported_date, completed_date, record_type,
                 repairs, tests, technician, notes, created_at)
            VALUES
                (:org, :asset, :reported, :completed, :rtype,
                 :repairs, :tests, :tech, :notes, :at)
            """
        ).bindparams(bindparam("repairs", type_=JSONB), bindparam("tests", type_=JSONB))
        rows = (
            await conn.execute(
                text(
                    """
                    SELECT asset_id, reported_date, completed_date, record_type,
                           repairs, tests, technician, notes, created_at
                    FROM historical_records WHERE org_id = :org ORDER BY id
                    """
                ),
                {"org": src_org},
            )
        ).mappings().all()
        n_hist = 0
        for r in rows:
            await conn.execute(
                ins_hist,
                {
                    "org": dest_org,
                    "asset": asset_map.get(r["asset_id"]),
                    "reported": r["reported_date"],
                    "completed": r["completed_date"],
                    "rtype": r["record_type"],
                    "repairs": r["repairs"],
                    "tests": r["tests"],
                    "tech": r["technician"],
                    "notes": r["notes"],
                    "at": r["created_at"],
                },
            )
            n_hist += 1

        # 6) Corpus chunks (org-private only; embeddings copied verbatim).
        has_figures = await figures_supported(conn)
        has_unit_models = await unit_models_supported(conn)
        extra_cols = ""
        if has_unit_models:
            extra_cols += ", unit_models"
        if has_figures:
            extra_cols += ", figures"
        chunk_map: dict[int, int] = {}
        rows = (
            await conn.execute(
                text(
                    f"""
                    SELECT id, doc_class, doc_id, doc_title, source_label, page, text,
                           embedding::text AS embedding, unit_model, asset_id{extra_cols}
                    FROM corpus_chunks WHERE org_id = :org ORDER BY id
                    """
                ),
                {"org": src_org},
            )
        ).mappings().all()
        ins_cols = (
            "doc_class, doc_id, doc_title, source_label, page, text, "
            "org_id, unit_model, asset_id, embedding"
        )
        ins_vals = (
            ":doc_class, :doc_id, :doc_title, :source_label, :page, :text, "
            ":org_id, :unit_model, :asset_id, CAST(:embedding AS vector)"
        )
        binds = []
        if has_unit_models:
            ins_cols += ", unit_models"
            ins_vals += ", :unit_models"
        if has_figures:
            ins_cols += ", figures"
            ins_vals += ", :figures"
            binds.append(bindparam("figures", type_=JSONB))
        ins_chunk = text(
            f"INSERT INTO corpus_chunks ({ins_cols}) VALUES ({ins_vals}) RETURNING id"
        )
        if binds:
            ins_chunk = ins_chunk.bindparams(*binds)
        for r in rows:
            params: dict[str, Any] = {
                "doc_class": r["doc_class"],
                "doc_id": r["doc_id"],
                "doc_title": r["doc_title"],
                "source_label": r["source_label"],
                "page": r["page"],
                "text": r["text"],
                "org_id": dest_org,
                "unit_model": r["unit_model"],
                "asset_id": asset_map.get(r["asset_id"]) if r["asset_id"] else None,
                "embedding": r["embedding"],
            }
            if has_unit_models:
                params["unit_models"] = r["unit_models"]
            if has_figures:
                params["figures"] = r["figures"]
            new_id = (await conn.execute(ins_chunk, params)).scalar_one()
            chunk_map[r["id"]] = new_id

        # 7) Tickets (fresh unique short_id, remapped asset_id).
        ticket_map: dict[int, int] = {}
        rows = (
            await conn.execute(
                text(
                    """
                    SELECT id, asset_id, title, status, severity, opened_by_role, opened_at,
                           initial_error_codes, initial_symptoms, fault_dump_raw,
                           fault_dump_parsed, pre_arrival_summary, closed_at
                    FROM tickets WHERE org_id = :org ORDER BY id
                    """
                ),
                {"org": src_org},
            )
        ).mappings().all()
        for r in rows:
            short_id = _gen_short_id()
            while (
                await conn.execute(
                    text("SELECT 1 FROM tickets WHERE short_id = :s"), {"s": short_id}
                )
            ).first() is not None:
                short_id = _gen_short_id()
            new_id = (
                await conn.execute(
                    text(
                        """
                        INSERT INTO tickets (
                            org_id, asset_id, title, short_id, status, severity,
                            opened_by_role, opened_at, initial_error_codes, initial_symptoms,
                            fault_dump_raw, fault_dump_parsed, pre_arrival_summary, closed_at
                        )
                        VALUES (
                            :org, :asset, :title, :short_id, :status, :severity,
                            :role, :opened_at, :codes, :symptoms,
                            :fdr, :fdp, :pre, :closed_at
                        )
                        RETURNING id
                        """
                    ),
                    {
                        "org": dest_org,
                        "asset": asset_map.get(r["asset_id"]),
                        "title": r["title"],
                        "short_id": short_id,
                        "status": r["status"],
                        "severity": r["severity"],
                        "role": r["opened_by_role"],
                        "opened_at": r["opened_at"],
                        "codes": r["initial_error_codes"],
                        "symptoms": r["initial_symptoms"],
                        "fdr": r["fault_dump_raw"],
                        "fdp": r["fault_dump_parsed"],
                        "pre": r["pre_arrival_summary"],
                        "closed_at": r["closed_at"],
                    },
                )
            ).scalar_one()
            ticket_map[r["id"]] = new_id

        # 8) ticket_parts + tribal_capture (child rows keyed by ticket).
        rows = (
            await conn.execute(
                text(
                    """
                    SELECT tp.ticket_id, tp.part_id, tp.qty, tp.added_via, tp.added_at
                    FROM ticket_parts tp JOIN tickets t ON t.id = tp.ticket_id
                    WHERE t.org_id = :org ORDER BY tp.id
                    """
                ),
                {"org": src_org},
            )
        ).mappings().all()
        n_tp = 0
        for r in rows:
            await conn.execute(
                text(
                    """
                    INSERT INTO ticket_parts (ticket_id, part_id, qty, added_via, added_at)
                    VALUES (:ticket, :part, :qty, :via, :at)
                    """
                ),
                {
                    "ticket": ticket_map.get(r["ticket_id"]),
                    "part": part_map.get(r["part_id"]),
                    "qty": r["qty"],
                    "via": r["added_via"],
                    "at": r["added_at"],
                },
            )
            n_tp += 1

        rows = (
            await conn.execute(
                text(
                    """
                    SELECT tc.ticket_id, tc.author, tc.text, tc.captured_at, tc.promoted_chunk_id
                    FROM tribal_capture tc JOIN tickets t ON t.id = tc.ticket_id
                    WHERE t.org_id = :org ORDER BY tc.id
                    """
                ),
                {"org": src_org},
            )
        ).mappings().all()
        n_tc = 0
        for r in rows:
            await conn.execute(
                text(
                    """
                    INSERT INTO tribal_capture (ticket_id, author, text, captured_at, promoted_chunk_id)
                    VALUES (:ticket, :author, :text, :at, :chunk)
                    """
                ),
                {
                    "ticket": ticket_map.get(r["ticket_id"]),
                    "author": r["author"],
                    "text": r["text"],
                    "at": r["captured_at"],
                    "chunk": chunk_map.get(r["promoted_chunk_id"]),
                },
            )
            n_tc += 1

    print(
        f"copy_org: {src_slug} → {dest_slug} (org #{dest_org}): "
        f"{len(asset_map)} assets, {len(part_map)} parts, {n_hist} history, "
        f"{len(chunk_map)} corpus chunks, {len(ticket_map)} tickets, "
        f"{n_tp} ticket-parts, {n_tc} tribal captures. Messages not copied."
    )
    await close_engine()


if __name__ == "__main__":
    asyncio.run(main())
