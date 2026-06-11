"""Embed and load the SHARED corpus (CFR regulation) into pgvector.

Shared corpus is cross-tenant reference material: org_id = NULL and unit_model =
NULL, so every organization's techs can cite it. Per-org, per-unit knowledge
(OEM manuals, tribal notes, repair/inspection history) is NOT loaded here — it is
loaded per company by `python -m scripts.load_org <slug>`.

Sources: backend/corpus-sources/raw/*.xml — eCFR sections per sources.json
(fetched by `python -m scripts.corpus_fetch`).

Only org_id IS NULL rows are replaced on each run; org-private chunks are left
intact, so rebuilding shared CFR never disturbs a tenant's loaded data.
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
MANIFEST = HERE / "corpus-sources" / "sources.json"
RAW_DIR = HERE / "corpus-sources" / "raw"

MAX_CHARS_PER_CHUNK = 6000
EMBED_BATCH = 96
SKIP_KEYS = {"HEAD", "AUTH", "CITA", "SOURCE", "EFFDATE", "EDNOTE", "RESERVED", "EAR"}


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

    sources = json.loads(MANIFEST.read_text("utf-8"))
    for s in sources:
        if s.get("kind") != "ecfr-xml":
            print(f"skip {s.get('out_filename')}: only ecfr-xml is shared corpus")
            continue
        fp = RAW_DIR / s["out_filename"]
        if not fp.exists():
            print(f"skip {s['out_filename']}: not on disk. Run `python -m scripts.corpus_fetch`.")
            continue
        root = ET.fromstring(fp.read_text("utf-8"))
        section_chunks = _chunk_ecfr(root, s)
        chunks.extend(section_chunks)
        print(f"{s['out_filename']}: {len(section_chunks)} sections")

    print(f"\ntotal: {len(chunks)} shared CFR chunks. Embedding…")
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.execute(text("SET statement_timeout = '10min'"))
        # Replace ONLY shared (org_id IS NULL) chunks; org-private data is untouched.
        await conn.execute(text("DELETE FROM corpus_chunks WHERE org_id IS NULL"))

        stmt = text(
            """
            INSERT INTO corpus_chunks
                (doc_class, doc_id, doc_title, source_label, page, text,
                 org_id, unit_model, asset_id, embedding)
            VALUES
                (:doc_class, :doc_id, :doc_title, :source_label, :page, :text,
                 NULL, NULL, NULL, CAST(:embedding AS vector))
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
                        "embedding": "[" + ",".join(str(x) for x in v) + "]",
                    },
                )
            done = min(i + EMBED_BATCH, len(chunks))
            print(f"  embedded {done}/{len(chunks)}", end="\r", flush=True)

    print(f"\ncorpus-build: ok. {len(chunks)} shared CFR chunks loaded (org_id = NULL).")
    await close_engine()


if __name__ == "__main__":
    asyncio.run(main())
