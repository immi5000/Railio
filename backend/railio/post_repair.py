"""Post-repair wrap-up: draft a repair-history record from a closed ticket's chat.

Mirror of pre_arrival.py but on the CLOSE side. Produces a short summary + a
suggested tech-notes block the wrap-up page can autofill. The actual write-back
to the corpus happens when the human files the wrap-up (see routers/tickets.py).
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import text

from .db import session_scope
from .messages_repo import list_messages
from .openai_client import chat_model, get_openai
from .tickets_repo import get_ticket_detail

_SYSTEM = """You are Railio, writing the permanent REPAIR RECORD for a locomotive
after a repair ticket is closed. You are given the ticket's chat thread and the
parts consumed. Produce two things, separated by a line containing only '---':

1. A SUMMARY: 2-4 sentences. Unit, symptom, root cause, what was done, outcome.
   This is the searchable history other techs will read later.
2. NOTES: 1-3 short bullet lines of tribal wisdom for next time — gotchas,
   what to check first, anything non-obvious. If nothing notable, write
   "- No additional notes."

Rules: be concrete and factual, draw ONLY from the thread. No greetings, no
headings beyond the two sections. Never invent part numbers or torque values."""


async def _parts_used_text(ticket_id: int) -> str:
    async with session_scope() as s:
        rows = (
            await s.execute(
                text(
                    """
                    SELECT p.part_number, p.name, tp.qty
                    FROM ticket_parts tp JOIN parts p ON p.id = tp.part_id
                    WHERE tp.ticket_id = :tid ORDER BY tp.id
                    """
                ),
                {"tid": ticket_id},
            )
        ).mappings().all()
    if not rows:
        return "(none recorded)"
    return "; ".join(f"{r['qty']}× {r['name']} ({r['part_number']})" for r in rows)


async def draft_repair_record(ticket_id: int) -> dict[str, Optional[str]]:
    """Return {summary, notes} drafted from the ticket. Resilient to failures."""
    t = await get_ticket_detail(ticket_id)
    if not t:
        return {"summary": None, "notes": None}

    msgs = await list_messages(ticket_id)
    transcript = "\n".join(
        f"[{m.role}] {m.content}" for m in msgs if m.role in ("dispatcher", "tech", "assistant") and m.content
    )[:6000]
    parts_txt = await _parts_used_text(ticket_id)

    a = t.asset
    user_msg = (
        f"Unit: {a.reporting_mark} {a.road_number} ({a.unit_model})\n"
        f"Severity: {t.severity}\n"
        f"Initial symptoms: {t.initial_symptoms or '—'}\n"
        f"Initial error codes: {t.initial_error_codes or '—'}\n"
        f"Parts used: {parts_txt}\n\n"
        f"Chat thread:\n{transcript or '(no conversation)'}"
    )

    try:
        client = get_openai()
        completion = await client.chat.completions.create(
            model=chat_model(),
            temperature=0.3,
            max_tokens=400,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": user_msg},
            ],
        )
        raw = (completion.choices[0].message.content or "").strip()
    except Exception as e:  # pragma: no cover
        print(f"[post-repair] draft failed: {e}")
        return {"summary": None, "notes": None}

    if "---" in raw:
        summary, notes = raw.split("---", 1)
        return {"summary": summary.strip(), "notes": notes.strip()}
    return {"summary": raw, "notes": None}
