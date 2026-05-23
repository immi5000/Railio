"""Parse raw locomotive diagnostic dumps via the LLM and persist."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text

from ..db import session_scope
from ..openai_client import chat_model, get_openai

_PARSER_SYSTEM = """Extract structured fault entries from a raw locomotive diagnostic dump (GE ToolBoxLOCO export, fault history screen, etc.).

Return ONLY a JSON object of shape { "faults": ParsedFault[] } where each fault is:
{ "code": string, "ts": string|null (ISO 8601 if present), "severity": "minor"|"major"|"critical", "description": string }

Rules:
- One object per distinct fault entry.
- code: the alphanumeric fault identifier as it appears (e.g. "EOA-3", "FUEL-PRESS-LOW").
- severity: infer from any flags ("CRITICAL", "WARN", "INFO") or fault category. Default "minor" if unknown.
- description: brief plain-text description; keep the original phrasing where possible.
- ts: parse any timestamp into ISO 8601, else null."""


async def parse_fault_dump(ticket_id: int, raw_text: str) -> dict[str, Any]:
    client = get_openai()
    r = await client.chat.completions.create(
        model=chat_model(),
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _PARSER_SYSTEM},
            {"role": "user", "content": raw_text},
        ],
    )
    txt = r.choices[0].message.content or "{}"
    parsed: list[dict[str, Any]] = []
    try:
        obj = json.loads(txt)
        if isinstance(obj, list):
            parsed = obj
        elif isinstance(obj, dict) and isinstance(obj.get("faults"), list):
            parsed = obj["faults"]
    except (TypeError, ValueError):
        parsed = []

    async with session_scope() as session:
        await session.execute(
            text("UPDATE tickets SET fault_dump_parsed = :p WHERE id = :id"),
            {"p": json.dumps(parsed), "id": ticket_id},
        )

    return {"parsed": parsed}
