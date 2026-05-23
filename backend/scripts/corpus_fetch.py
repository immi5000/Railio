"""Download corpus source documents per backend/corpus-sources/sources.json."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent.parent
MANIFEST = HERE / "corpus-sources" / "sources.json"
RAW_DIR = HERE / "corpus-sources" / "raw"


async def main() -> None:
    sources = json.loads(MANIFEST.read_text("utf-8"))
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    force = "--force" in sys.argv

    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        for s in sources:
            out = RAW_DIR / s["out_filename"]
            if out.exists() and out.stat().st_size > 0 and not force:
                print(f"skip  {s['out_filename']} (exists; --force to refetch)")
                continue
            accept = "application/xml" if s["kind"] == "ecfr-xml" else "application/pdf"
            print(f"fetch {s['out_filename']} … ", end="", flush=True)
            r = await client.get(s["url"], headers={"Accept": accept})
            if r.status_code != 200:
                print(f"FAILED ({r.status_code})")
                print(f"  url: {s['url']}")
                continue
            out.write_bytes(r.content)
            print(f"ok ({len(r.content) / 1024:.0f} KB)")

    print("corpus-fetch: done.")


if __name__ == "__main__":
    asyncio.run(main())
