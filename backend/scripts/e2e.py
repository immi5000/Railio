"""End-to-end smoke test against the running FastAPI server.

Assumes the server is listening on http://localhost:$PORT (default 3001).
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import httpx

BASE = f"http://localhost:{os.environ.get('PORT', '3001')}"


async def _json(client: httpx.AsyncClient, method: str, url: str, body: Any = None) -> Any:
    r = await client.request(method, BASE + url, json=body)
    r.raise_for_status()
    return r.json()


async def _consume_sse(client: httpx.AsyncClient, url: str, body: Any) -> None:
    async with client.stream(
        "POST",
        BASE + url,
        json=body,
        headers={"Accept": "text/event-stream"},
        timeout=120.0,
    ) as r:
        r.raise_for_status()
        buf = ""
        async for chunk in r.aiter_text():
            buf += chunk
            while "\n\n" in buf:
                frame, buf = buf.split("\n\n", 1)
                frame = frame.strip()
                if not frame.startswith("data:"):
                    continue
                ev = json.loads(frame[5:].strip())
                extra = (
                    f"(+{len(ev.get('delta', ''))}ch)"
                    if ev["type"] == "assistant_token"
                    else ""
                )
                print(f"sse {ev['type']} {extra}")
                if ev["type"] in ("done", "error"):
                    return


async def main() -> None:
    async with httpx.AsyncClient(timeout=60.0) as client:
        ticket = await _json(
            client,
            "POST",
            "/api/tickets",
            {
                "asset_id": 1,
                "initial_symptoms": "Smoke from #3 power assembly per crew",
                "initial_error_codes": "EOA-3, FUEL-PRESS-LOW",
                "fault_dump_raw": (
                    "2026-04-30 06:14:02 EOA-3 SEVERITY=MAJOR Engine oil aeration\n"
                    "2026-04-30 06:14:02 FUEL-PRESS-LOW WARN rail pressure 1180 bar in notch 5"
                ),
                "opened_by_role": "dispatcher",
            },
        )
        print("created ticket", ticket["id"])

        await _json(
            client,
            "POST",
            f"/api/tickets/{ticket['id']}/parse-fault-dump",
            {"raw": ticket["fault_dump_raw"]},
        )

        await _consume_sse(
            client,
            f"/api/tickets/{ticket['id']}/messages",
            {
                "role": "dispatcher",
                "content": "ES44DC 7670, smoke from #3 power assembly per crew. Pre-brief the tech.",
            },
        )
        await _consume_sse(
            client,
            f"/api/tickets/{ticket['id']}/messages",
            {
                "role": "tech",
                "content": "On site. Smoke residue confirmed at #3. What should I check first?",
            },
        )
        await _consume_sse(
            client,
            f"/api/tickets/{ticket['id']}/messages",
            {"role": "tech", "content": "Pressure looks normal. Need part for the injector."},
        )

    print("e2e: done. Run `python -m scripts.verify_chain` to validate the hash chain.")


if __name__ == "__main__":
    asyncio.run(main())
