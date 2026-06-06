"""Embed corpus chunks and load into pgvector.

Sources loaded (all from backend/seeds/ and backend/corpus-sources/):
  - tribal-notes.json         senior-tech tribal knowledge
  - corpus-es44dc-manual.json GE ES44DC Operating Manual (GEJ-6915)
  - repair-history.json       past repair records for seeded units
  - inspection-history.json   past 49 CFR §229.21 daily inspection records
  - corpus-sources/raw/*.xml  eCFR sections per sources.json manifest
"""

from __future__ import annotations

import asyncio
import html
import json
import os
import re
from pathlib import Path
from typing import Any, Iterator
from xml.etree import ElementTree as ET

from sqlalchemy import text

from railio.db import close_engine, get_engine
from railio.embeddings import embed

if os.environ.get("DATABASE_URL_DIRECT"):
    os.environ["DATABASE_URL"] = os.environ["DATABASE_URL_DIRECT"]

HERE = Path(__file__).resolve().parent.parent
SEEDS = HERE / "seeds"
MANIFEST = HERE / "corpus-sources" / "sources.json"
RAW_DIR = HERE / "corpus-sources" / "raw"

# Hand-written JSON seed files loaded as-is into corpus_chunks.
HANDWRITTEN_SEEDS = [
    "tribal-notes.json",
    "corpus-es44dc-manual.json",
    "repair-history.json",
    "inspection-history.json",
]

MAX_CHARS_PER_CHUNK = 6000
EMBED_BATCH = 96
SKIP_KEYS = {"HEAD", "AUTH", "CITA", "SOURCE", "EFFDATE", "EDNOTE", "RESERVED", "EAR"}

# Default model for the v0 fleet. Manual + tribal + history chunks are ES44DC;
# CFR is shared (unit_model stays null). Multi-model later: tag per source file.
DEFAULT_UNIT_MODEL = "ES44DC"


async def _road_number_to_asset_id() -> dict[str, int]:
    """Map road_number -> asset id so unit-specific history chunks can be scoped."""
    from railio.db import session_scope

    out: dict[str, int] = {}
    async with session_scope() as s:
        rows = (await s.execute(text("SELECT id, road_number FROM assets"))).mappings().all()
        for r in rows:
            out[str(r["road_number"])] = r["id"]
    return out


def _scope_for_chunk(chunk: dict[str, Any], road_to_asset: dict[str, int]) -> dict[str, Any]:
    """Decide unit_model + asset_id for a corpus chunk from its doc_id convention.

    - cfr_*            -> shared (unit_model null, asset_id null)
    - ge_es44dc_*      -> ES44DC manual (asset_id null)
    - tribal_*         -> ES44DC fleet wisdom, cross-unit (asset_id null)
    - inspection_*/repair_* with a road number -> ES44DC, scoped to that asset
    """
    doc_id = chunk.get("doc_id", "")
    if doc_id.startswith("cfr_"):
        return {"unit_model": None, "asset_id": None}
    asset_id = None
    for rn, aid in road_to_asset.items():
        if rn and rn in doc_id:
            asset_id = aid
            break
    return {"unit_model": DEFAULT_UNIT_MODEL, "asset_id": asset_id}


def _walk(node: ET.Element) -> Iterator[ET.Element]:
    yield node
    for c in list(node):
        yield from _walk(c)


def _text_of(node: ET.Element) -> str:
    parts: list[str] = []
    if node.text:
        parts.append(node.text)
    for c in list(node):
        parts.append(_text_of(c))
        if c.tail:
            parts.append(c.tail)
    return "".join(parts)


def _sub_split(t: str, max_chars: int) -> list[str]:
    paragraphs = re.split(r"\n\n+", t)
    out: list[str] = []
    buf = ""
    for p in paragraphs:
        if len(buf) + len(p) + 2 <= max_chars:
            buf = f"{buf}\n\n{p}" if buf else p
        else:
            if buf:
                out.append(buf)
            if len(p) <= max_chars:
                buf = p
            else:
                for i in range(0, len(p), max_chars):
                    out.append(p[i : i + max_chars])
                buf = ""
    if buf:
        out.append(buf)
    return out


def _chunk_ecfr(root: ET.Element, src: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for node in _walk(root):
        if node.attrib.get("TYPE") != "SECTION" or not node.attrib.get("N"):
            continue
        section_n = node.attrib["N"]
        head_node = node.find("HEAD")
        head_raw = html.unescape(_text_of(head_node)) if head_node is not None else ""
        head_raw = re.sub(r"\s+", " ", head_raw).strip()
        head = re.sub(r"^§\s*\S+\s*", "", head_raw).strip()

        body_parts: list[str] = []
        for c in list(node):
            if c.tag in SKIP_KEYS:
                continue
            t = html.unescape(_text_of(c))
            t = re.sub(r"[ \t]+\n", "\n", t)
            t = re.sub(r"\n{3,}", "\n\n", t).strip()
            if t:
                body_parts.append(t)
        body = re.sub(r"\n{3,}", "\n\n", "\n".join(body_parts)).strip()
        if not body:
            continue

        full = f"{head}\n\n{body}" if head else body
        label_base = f"49 CFR §{section_n}" + (f" — {head}" if head else "")
        base = {
            "doc_class": src["doc_class"],
            "doc_id": src["doc_id"],
            "doc_title": src["doc_title"],
            "page": None,
        }

        if len(full) <= MAX_CHARS_PER_CHUNK:
            out.append({**base, "source_label": label_base, "text": full})
        else:
            parts = _sub_split(full, MAX_CHARS_PER_CHUNK)
            for i, p in enumerate(parts):
                out.append(
                    {
                        **base,
                        "source_label": f"{label_base} (part {i + 1}/{len(parts)})",
                        "text": p,
                    }
                )
    return out


async def main() -> None:
    chunks: list[dict[str, Any]] = []

    for name in HANDWRITTEN_SEEDS:
        p = SEEDS / name
        if not p.exists():
            print(f"skip {name}: not on disk")
            continue
        data = json.loads(p.read_text("utf-8"))
        chunks.extend(data)
        print(f"{name}: {len(data)} chunks")

    sources = json.loads(MANIFEST.read_text("utf-8"))
    for s in sources:
        fp = RAW_DIR / s["out_filename"]
        if not fp.exists():
            print(f"skip {s['out_filename']}: not on disk. Run `python -m scripts.corpus_fetch`.")
            continue
        if s["kind"] == "ecfr-xml":
            root = ET.fromstring(fp.read_text("utf-8"))
            section_chunks = _chunk_ecfr(root, s)
            chunks.extend(section_chunks)
            print(f"{s['out_filename']}: {len(section_chunks)} sections")
        else:
            print(f"unsupported kind {s['kind']} ({s['out_filename']}); skipping")

    road_to_asset = await _road_number_to_asset_id()
    for c in chunks:
        c.update(_scope_for_chunk(c, road_to_asset))

    print(f"\ntotal: {len(chunks)} chunks. Embedding…")
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.execute(text("SET statement_timeout = '10min'"))
        await conn.execute(text("DELETE FROM corpus_chunks"))
        await conn.execute(
            text("SELECT setval(pg_get_serial_sequence('corpus_chunks', 'id'), 1, false)")
        )

        stmt = text(
            """
            INSERT INTO corpus_chunks
                (doc_class, doc_id, doc_title, source_label, page, text,
                 unit_model, asset_id, embedding)
            VALUES
                (:doc_class, :doc_id, :doc_title, :source_label, :page, :text,
                 :unit_model, :asset_id, CAST(:embedding AS vector))
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
                        "unit_model": c.get("unit_model"),
                        "asset_id": c.get("asset_id"),
                        "embedding": "[" + ",".join(str(x) for x in v) + "]",
                    },
                )
            done = min(i + EMBED_BATCH, len(chunks))
            print(f"  embedded {done}/{len(chunks)}", end="\r", flush=True)

    print(f"\ncorpus-build: ok. {len(chunks)} chunks loaded.")
    await close_engine()


if __name__ == "__main__":
    asyncio.run(main())
