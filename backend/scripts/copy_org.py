"""Copy one organization's private data into another organization.

Admin tool for cloning a tenant's live data (fleet, inventory, tickets, and
knowledge corpus) from a source org into a destination org — e.g. to give the
`test` org a realistic mirror of `omnitrax`:

    python -m scripts.copy_org omnitrax test

Optional flags re-identify the clone as a different railroad, so it can be handed
to an outside tester without exposing the source railroad's fleet or staff:

    python -m scripts.copy_org omnitrax wafa \\
        --name Wafa --reporting-mark WAFX --road-offset 10 \\
        --department MECH --subsidiary WAFA:MAIN \\
        --anonymize-people --invite-code join-wafa

When --reporting-mark / --road-offset / --anonymize-people are given, the copy
also rewrites the free text it carries across (corpus chunk text, titles, labels
and doc_ids; ticket titles/symptoms/summaries; maintenance notes; tribal
captures) so the prose matches the new fleet. Cited ticket short_ids are remapped
to the destination's regenerated ones. Rewriting the text invalidates the source
embeddings, so affected corpus chunks are re-embedded — pass --no-reembed to copy
the stale vectors verbatim instead (cheaper, but semantic search then matches
against the *old* names).

The destination is created if its slug doesn't exist yet, and its existing
org-private data is wiped first so the result is a clean 1:1 mirror. App users
and domain rules on the destination are left untouched, so people already in the
org keep their access.

What is copied (all integer PKs are remapped to the destination):
    assets → parts → historical_records → tickets (fresh short_id)
    → corpus_chunks (org-private only) → ticket_parts → tribal_capture

What is NOT copied: messages (ticket threads start empty), the shared CFR corpus
(org_id IS NULL — already visible to every org), and identity rows
(app_users / org_domains).
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
from typing import Any

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from railio.corpus_figures import figures_supported, unit_models_supported
from railio.db import close_engine, get_engine
from railio.embeddings import embed
from railio.messages_repo import _iso_now
from railio.tickets_repo import _gen_short_id

if os.environ.get("DATABASE_URL_DIRECT"):
    os.environ["DATABASE_URL"] = os.environ["DATABASE_URL_DIRECT"]

EMBED_BATCH = 96

# Aliases for --anonymize-people, in the source data's "Last, First" shape.
FAKE_NAMES = [
    "Rivera, Marcus",
    "Okafor, Daniel",
    "Lindqvist, Erik",
    "Navarro, Elena",
    "Boone, Travis",
    "Ashford, Curtis",
    "Delgado, Ramon",
    "Whitfield, Dana",
    "Kovacs, Peter",
    "Ellison, Grant",
]


def _offset_road_number(road_number: str, offset: int) -> str:
    """Shift a numeric road number, preserving a non-numeric one verbatim."""
    rn = (road_number or "").strip()
    if not offset or not rn.isdigit():
        return road_number
    return str(int(rn) + offset)


class Scrubber:
    """Rewrites the source railroad's identifiers out of copied free text.

    Road numbers are matched two ways because they appear in two shapes: as words
    in prose ("unit 3814"), and as an underscore-delimited segment inside doc_ids
    ("history_omlx_3814_148"), where \\b cannot fire because _ is a word char.
    Only the segment between underscores is rewritten there, never the trailing
    counter — which may coincidentally equal some other unit's road number.
    """

    def __init__(
        self,
        *,
        mark_map: dict[str, str],
        road_map: dict[str, str],
        people_map: dict[str, str],
    ) -> None:
        self.mark_map = mark_map
        self.road_map = road_map
        self.people_map = people_map
        self.short_id_map: dict[str, str] = {}  # filled once tickets are copied
        self._road_re = (
            re.compile(r"\b(" + "|".join(sorted(map(re.escape, road_map), key=len, reverse=True)) + r")\b")
            if road_map
            else None
        )
        self._seg_re = (
            re.compile(r"_(" + "|".join(sorted(map(re.escape, road_map), key=len, reverse=True)) + r")_")
            if road_map
            else None
        )

    @property
    def active(self) -> bool:
        return bool(self.mark_map or self.road_map or self.people_map or self.short_id_map)

    def __call__(self, value: Any) -> Any:
        if isinstance(value, list):
            return [self(v) for v in value]
        if isinstance(value, dict):
            return {k: self(v) for k, v in value.items()}
        if not isinstance(value, str) or not value:
            return value

        s = value
        for old, new in self.mark_map.items():
            s = s.replace(old, new).replace(old.lower(), new.lower())
        if self._seg_re:
            s = self._seg_re.sub(lambda m: f"_{self.road_map[m.group(1)]}_", s)
        if self._road_re:
            s = self._road_re.sub(lambda m: self.road_map[m.group(1)], s)
        for real, fake in self.people_map.items():
            s = s.replace(real, fake)
            real_last, _, real_first = real.partition(", ")
            fake_last, _, fake_first = fake.partition(", ")
            if real_first:
                s = re.sub(rf"\b{re.escape(real_last)}\b", fake_last, s)
                s = re.sub(rf"\b{re.escape(real_first)}\b", fake_first, s)
        for old, new in self.short_id_map.items():
            s = s.replace(old, new)
        return s


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="python -m scripts.copy_org")
    p.add_argument("source_slug")
    p.add_argument("dest_slug")
    p.add_argument("--name", help="display name for the destination org (default: source's)")
    p.add_argument("--reporting-mark", help="rewrite every copied asset's reporting_mark")
    p.add_argument("--road-offset", type=int, default=0, help="add N to numeric road numbers")
    p.add_argument("--department", help="rewrite every copied part's department")
    p.add_argument("--subsidiary", help="rewrite every copied part's subsidiary")
    p.add_argument(
        "--anonymize-people",
        action="store_true",
        help="replace technician / author names with consistent aliases",
    )
    p.add_argument(
        "--no-reembed",
        action="store_true",
        help="copy embeddings verbatim even when the chunk text was rewritten",
    )
    p.add_argument("--invite-code", help="create/point this invite code at the destination org")
    return p.parse_args()


async def main() -> None:
    args = _parse_args()
    src_slug = args.source_slug.strip()
    dest_slug = args.dest_slug.strip()
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
                    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                    RETURNING id
                    """
                ),
                {"name": args.name or src["name"], "slug": dest_slug, "at": _iso_now()},
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

        # 3) Build the identifier maps the scrubber needs, from the source rows.
        src_assets = (
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

        mark_map: dict[str, str] = {}
        road_map: dict[str, str] = {}
        if args.reporting_mark:
            mark_map = {a["reporting_mark"]: args.reporting_mark for a in src_assets}
        if args.road_offset:
            road_map = {
                a["road_number"]: _offset_road_number(a["road_number"], args.road_offset)
                for a in src_assets
            }

        people_map: dict[str, str] = {}
        if args.anonymize_people:
            names = (
                await conn.execute(
                    text(
                        """
                        SELECT DISTINCT technician AS n FROM historical_records
                        WHERE org_id = :org AND technician IS NOT NULL
                        UNION
                        SELECT DISTINCT tc.author AS n FROM tribal_capture tc
                        JOIN tickets t ON t.id = tc.ticket_id
                        WHERE t.org_id = :org AND tc.author IS NOT NULL
                        """
                    ),
                    {"org": src_org},
                )
            ).scalars().all()
            people_map = {
                real: FAKE_NAMES[i % len(FAKE_NAMES)] for i, real in enumerate(sorted(names))
            }

        scrub = Scrubber(mark_map=mark_map, road_map=road_map, people_map=people_map)

        # 4) Assets.
        asset_map: dict[int, int] = {}
        for r in src_assets:
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
                        "rm": args.reporting_mark or r["reporting_mark"],
                        "rn": _offset_road_number(r["road_number"], args.road_offset),
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

        # 5) Parts.
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
            params = {"org": dest_org, **{k: r[k] for k in r.keys() if k != "id"}}
            if args.department:
                params["department"] = args.department
            if args.subsidiary:
                params["subsidiary"] = args.subsidiary
            new_id = (await conn.execute(ins_part, params)).scalar_one()
            part_map[r["id"]] = new_id

        # 6) Tickets — before the corpus, so repair chunks citing a ticket's
        #    short_id can be rewritten to the destination's regenerated one.
        ticket_map: dict[int, int] = {}
        rows = (
            await conn.execute(
                text(
                    """
                    SELECT id, asset_id, title, short_id, status, severity, opened_by_role,
                           opened_at, initial_error_codes, initial_symptoms, fault_dump_raw,
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
            if r["short_id"]:
                scrub.short_id_map[r["short_id"]] = short_id
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
                        "title": scrub(r["title"]),
                        "short_id": short_id,
                        "status": r["status"],
                        "severity": r["severity"],
                        "role": r["opened_by_role"],
                        "opened_at": r["opened_at"],
                        "codes": scrub(r["initial_error_codes"]),
                        "symptoms": scrub(r["initial_symptoms"]),
                        "fdr": scrub(r["fault_dump_raw"]),
                        "fdp": scrub(r["fault_dump_parsed"]),
                        "pre": scrub(r["pre_arrival_summary"]),
                        "closed_at": r["closed_at"],
                    },
                )
            ).scalar_one()
            ticket_map[r["id"]] = new_id

        # 7) Historical records.
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
                    "repairs": scrub(r["repairs"]),
                    "tests": scrub(r["tests"]),
                    "tech": scrub(r["technician"]),
                    "notes": scrub(r["notes"]),
                    "at": r["created_at"],
                },
            )
            n_hist += 1

        # 8) Corpus chunks (org-private only).
        has_figures = await figures_supported(conn)
        has_unit_models = await unit_models_supported(conn)
        extra_cols = ""
        if has_unit_models:
            extra_cols += ", unit_models"
        if has_figures:
            extra_cols += ", figures"
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

        chunks: list[dict[str, Any]] = []
        for r in rows:
            new_text = scrub(r["text"])
            chunks.append(
                {
                    "src_id": r["id"],
                    "doc_class": r["doc_class"],
                    "doc_id": scrub(r["doc_id"]),
                    "doc_title": scrub(r["doc_title"]),
                    "source_label": scrub(r["source_label"]),
                    "page": r["page"],
                    "text": new_text,
                    "embedding": r["embedding"],
                    "rewritten": new_text != r["text"],
                    "unit_model": r["unit_model"],
                    "asset_id": asset_map.get(r["asset_id"]) if r["asset_id"] else None,
                    "unit_models": r["unit_models"] if has_unit_models else None,
                    "figures": r["figures"] if has_figures else None,
                }
            )

        # A rewritten chunk's source vector encodes the OLD names — re-embed it,
        # or semantic search silently matches against text that no longer exists.
        stale = [c for c in chunks if c["rewritten"]]
        n_reembedded = 0
        if stale and not args.no_reembed:
            print(f"copy_org: re-embedding {len(stale)} rewritten corpus chunks…")
            for i in range(0, len(stale), EMBED_BATCH):
                batch = stale[i : i + EMBED_BATCH]
                vecs = await embed([c["text"] for c in batch], "document")
                for c, v in zip(batch, vecs, strict=True):
                    c["embedding"] = "[" + ",".join(str(x) for x in v) + "]"
                n_reembedded += len(batch)
                print(f"  embedded {n_reembedded}/{len(stale)}", end="\r", flush=True)
            print()

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

        chunk_map: dict[int, int] = {}
        for c in chunks:
            params = {
                "doc_class": c["doc_class"],
                "doc_id": c["doc_id"],
                "doc_title": c["doc_title"],
                "source_label": c["source_label"],
                "page": c["page"],
                "text": c["text"],
                "org_id": dest_org,
                "unit_model": c["unit_model"],
                "asset_id": c["asset_id"],
                "embedding": c["embedding"],
            }
            if has_unit_models:
                params["unit_models"] = c["unit_models"]
            if has_figures:
                params["figures"] = c["figures"]
            chunk_map[c["src_id"]] = (await conn.execute(ins_chunk, params)).scalar_one()

        # 9) ticket_parts + tribal_capture (child rows keyed by ticket).
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
                    "author": scrub(r["author"]),
                    "text": scrub(r["text"]),
                    "at": r["captured_at"],
                    "chunk": chunk_map.get(r["promoted_chunk_id"]),
                },
            )
            n_tc += 1

        # 10) Invite code, so a tester can self-onboard into the destination org.
        if args.invite_code:
            await conn.execute(
                text(
                    """
                    INSERT INTO org_invite_codes (code, org_id, used_count, created_at)
                    VALUES (:code, :org, 0, :at)
                    ON CONFLICT (code) DO UPDATE SET org_id = EXCLUDED.org_id
                    """
                ),
                {"code": args.invite_code, "org": dest_org, "at": _iso_now()},
            )

    rewritten = sum(1 for c in chunks if c["rewritten"])
    print(
        f"copy_org: {src_slug} → {dest_slug} (org #{dest_org}): "
        f"{len(asset_map)} assets, {len(part_map)} parts, {n_hist} history, "
        f"{len(chunk_map)} corpus chunks ({rewritten} rewritten, {n_reembedded} re-embedded), "
        f"{len(ticket_map)} tickets, {n_tp} ticket-parts, {n_tc} tribal captures. "
        f"Messages not copied."
    )
    if people_map:
        print("copy_org: name aliases → " + ", ".join(f"{r} = {f}" for r, f in people_map.items()))
    await close_engine()


if __name__ == "__main__":
    asyncio.run(main())
