"""Load (or refresh) one organization's data from backend/org-data/<slug>/.

This is the admin onboarding path: YOU prepare a company's data on disk, then run
this once to ingest it. Tenants do not upload their own data in the pilot.

Folder layout (everything except org.json is optional):

    backend/org-data/<slug>/
      org.json              {"name": "...", "slug": "..."}            (required)
      assets.json           [{reporting_mark, road_number, unit_model, ...}]
      parts.json            [{part_number, name, compatible_units, ...}]  (org-exclusive)
      corpus/*.json         each file an array of corpus chunks:
                              {doc_class, doc_id, doc_title, source_label,
                               text, page?, unit_model?, road_number?}

Scoping applied to every corpus chunk loaded here:
  - org_id     = this org (never NULL — these are org-private; CFR is loaded
                 separately by corpus_build with org_id NULL).
  - unit_model = chunk.unit_model if set, else inferred from the chunk's
                 road_number's asset, else left NULL (org-wide).
  - asset_id   = the asset matching chunk.road_number (explicit field) or a road
                 number found as a substring of doc_id; else NULL (not unit-specific).

Re-running is idempotent: the org's existing assets/parts/private corpus are
deleted and reloaded. CFR (org_id NULL) and other orgs are never touched.

Usage:
    python -m scripts.load_org <slug>
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from railio.db import close_engine, get_engine
from railio.embeddings import embed
from railio.messages_repo import _iso_now

if os.environ.get("DATABASE_URL_DIRECT"):
    os.environ["DATABASE_URL"] = os.environ["DATABASE_URL_DIRECT"]

ORG_DATA = Path(__file__).resolve().parent.parent / "org-data"
EMBED_BATCH = 96


def _read_json(p: Path) -> Any:
    return json.loads(p.read_text("utf-8"))


def _scope_chunk(
    chunk: dict[str, Any], road_to_asset: dict[str, dict[str, Any]]
) -> dict[str, Optional[Any]]:
    """Resolve unit_model + asset_id for one org-private corpus chunk."""
    asset: Optional[dict[str, Any]] = None
    rn = chunk.get("road_number")
    if rn and str(rn) in road_to_asset:
        asset = road_to_asset[str(rn)]
    else:
        doc_id = chunk.get("doc_id", "")
        for road, a in road_to_asset.items():
            if road and road in doc_id:
                asset = a
                break
    unit_model = chunk.get("unit_model") or (asset["unit_model"] if asset else None)
    asset_id = asset["id"] if asset else None
    return {"unit_model": unit_model, "asset_id": asset_id}


async def main() -> None:
    if len(sys.argv) < 2:
        print("usage: python -m scripts.load_org <slug>")
        raise SystemExit(2)
    slug = sys.argv[1].strip()
    org_dir = ORG_DATA / slug
    org_meta_path = org_dir / "org.json"
    if not org_meta_path.exists():
        print(f"load_org: no org.json at {org_meta_path}")
        raise SystemExit(1)

    org_meta = _read_json(org_meta_path)
    name = org_meta["name"]
    slug = org_meta.get("slug", slug)

    assets = _read_json(org_dir / "assets.json") if (org_dir / "assets.json").exists() else []
    parts = _read_json(org_dir / "parts.json") if (org_dir / "parts.json").exists() else []
    corpus_files = sorted((org_dir / "corpus").glob("*.json")) if (org_dir / "corpus").is_dir() else []

    engine = get_engine()

    # 1) Upsert the organization, get its id.
    async with engine.begin() as conn:
        org_id = (
            await conn.execute(
                text(
                    """
                    INSERT INTO organizations (name, slug, created_at)
                    VALUES (:name, :slug, :at)
                    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                    RETURNING id
                    """
                ),
                {"name": name, "slug": slug, "at": _iso_now()},
            )
        ).scalar_one()

        # 2) Wipe this org's existing private data so re-running is clean.
        #    Order respects FKs: tickets/messages/parts first, then corpus, assets.
        await conn.execute(
            text(
                """
                DELETE FROM ticket_parts WHERE ticket_id IN
                    (SELECT id FROM tickets WHERE org_id = :org)
                """
            ),
            {"org": org_id},
        )
        await conn.execute(
            text(
                """
                DELETE FROM tribal_capture WHERE ticket_id IN
                    (SELECT id FROM tickets WHERE org_id = :org)
                """
            ),
            {"org": org_id},
        )
        await conn.execute(
            text(
                """
                DELETE FROM messages WHERE ticket_id IN
                    (SELECT id FROM tickets WHERE org_id = :org)
                """
            ),
            {"org": org_id},
        )
        await conn.execute(text("DELETE FROM tickets WHERE org_id = :org"), {"org": org_id})
        await conn.execute(text("DELETE FROM parts WHERE org_id = :org"), {"org": org_id})
        await conn.execute(text("DELETE FROM corpus_chunks WHERE org_id = :org"), {"org": org_id})
        await conn.execute(text("DELETE FROM assets WHERE org_id = :org"), {"org": org_id})

        # 3) Assets.
        road_to_asset: dict[str, dict[str, Any]] = {}
        for a in assets:
            aid = (
                await conn.execute(
                    text(
                        """
                        INSERT INTO assets (org_id, reporting_mark, road_number, unit_model,
                                            in_service_date, last_inspection_at)
                        VALUES (:org, :rm, :rn, :um, :in_svc, :last)
                        RETURNING id
                        """
                    ),
                    {
                        "org": org_id,
                        "rm": a["reporting_mark"],
                        "rn": a["road_number"],
                        "um": a["unit_model"],
                        "in_svc": a.get("in_service_date"),
                        "last": a.get("last_inspection_at"),
                    },
                )
            ).scalar_one()
            road_to_asset[str(a["road_number"])] = {"id": aid, "unit_model": a["unit_model"]}

        # 4) Parts (org-exclusive inventory).
        ins_part = (
            text(
                """
                INSERT INTO parts (
                    org_id, part_number, name, description, compatible_units,
                    bin_location, qty_on_hand, supplier, lead_time_days,
                    alternate_part_numbers, last_used_at
                )
                VALUES (
                    :org, :part_number, :name, :description, :compatible_units,
                    :bin_location, :qty_on_hand, :supplier, :lead_time_days,
                    :alternate_part_numbers, :last_used_at
                )
                """
            ).bindparams(
                bindparam("compatible_units", type_=JSONB),
                bindparam("alternate_part_numbers", type_=JSONB),
            )
        )
        for p in parts:
            await conn.execute(
                ins_part,
                {
                    "org": org_id,
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

    print(f"load_org[{slug}]: org #{org_id} — {len(assets)} assets, {len(parts)} parts")

    # 5) Corpus (org-private). Collect, scope, embed in batches, insert.
    chunks: list[dict[str, Any]] = []
    for f in corpus_files:
        data = _read_json(f)
        chunks.extend(data)
        print(f"load_org[{slug}]: {f.name} — {len(data)} chunks")
    for c in chunks:
        c.update(_scope_chunk(c, road_to_asset))

    if chunks:
        print(f"load_org[{slug}]: embedding {len(chunks)} corpus chunks…")
        async with engine.begin() as conn:
            await conn.execute(text("SET statement_timeout = '10min'"))
            stmt = text(
                """
                INSERT INTO corpus_chunks
                    (doc_class, doc_id, doc_title, source_label, page, text,
                     org_id, unit_model, asset_id, embedding)
                VALUES
                    (:doc_class, :doc_id, :doc_title, :source_label, :page, :text,
                     :org_id, :unit_model, :asset_id, CAST(:embedding AS vector))
                """
            )
            for i in range(0, len(chunks), EMBED_BATCH):
                slice_ = chunks[i : i + EMBED_BATCH]
                vecs = await embed([c["text"] for c in slice_], "document")
                for c, v in zip(slice_, vecs, strict=True):
                    await conn.execute(
                        stmt,
                        {
                            "doc_class": c["doc_class"],
                            "doc_id": c["doc_id"],
                            "doc_title": c["doc_title"],
                            "source_label": c["source_label"],
                            "page": c.get("page"),
                            "text": c["text"],
                            "org_id": org_id,
                            "unit_model": c.get("unit_model"),
                            "asset_id": c.get("asset_id"),
                            "embedding": "[" + ",".join(str(x) for x in v) + "]",
                        },
                    )
                done = min(i + EMBED_BATCH, len(chunks))
                print(f"  embedded {done}/{len(chunks)}", end="\r", flush=True)
        print()

    print(f"load_org[{slug}]: ok. Use X-Org-Id: {slug} to access this org's data.")
    await close_engine()


if __name__ == "__main__":
    asyncio.run(main())
