"""Pre-arrival brief generation."""

from __future__ import annotations

from typing import Optional

from .contract import Asset, Severity
from .openai_client import chat_model, get_openai
from .tools.search_corpus import search_corpus

_SYSTEM = """You are Railio, a rail-maintenance dispatcher's AI co-pilot.
Write a TIGHT pre-arrival brief — 2 to 4 sentences max — for the technician
walking up to the locomotive. State the unit, the symptom, the most likely
root cause, and what the tech should bring or check first.

Rules:
- Be concrete. No fluff, no greetings, no headings.
- Lean on the manual / tribal context if provided. Cite source labels in
  parentheses inline (e.g. "(AAR §4.2.7)") when you use them.
- If you genuinely don't know, say "Cause unclear; tech to confirm on site."
- Never invent part numbers, page numbers, or torque values."""


async def generate_pre_arrival_summary(
    *,
    asset: Asset,
    severity: Severity,
    initial_symptoms: Optional[str],
    initial_error_codes: Optional[str],
    fault_dump_raw: Optional[str],
) -> Optional[str]:
    if not any((initial_symptoms, initial_error_codes, fault_dump_raw)):
        return None

    citations: list[tuple[str, str]] = []
    try:
        query = " ".join(
            x for x in (asset.unit_model, initial_symptoms, initial_error_codes) if x
        ).strip()
        if query:
            res = await search_corpus(query=query, k=4, doc_class_filter="any")
            citations = [(c["source_label"], c["text"][:400]) for c in res["chunks"]]
    except Exception:
        pass

    user_lines = [
        f"Unit: {asset.reporting_mark} {asset.road_number} ({asset.unit_model})",
        f"Severity: {severity}",
    ]
    if initial_symptoms:
        user_lines.append(f"Symptoms: {initial_symptoms}")
    if initial_error_codes:
        user_lines.append(f"Error codes: {initial_error_codes}")
    if fault_dump_raw:
        user_lines.append(f"Fault dump (truncated): {fault_dump_raw[:1500]}")
    if citations:
        user_lines.append(
            "\nGrounding (use only what's relevant):\n"
            + "\n".join(f"- ({lab}) {t}" for lab, t in citations)
        )
    user_msg = "\n".join(user_lines)

    try:
        client = get_openai()
        completion = await client.chat.completions.create(
            model=chat_model(),
            temperature=0.3,
            max_tokens=220,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": user_msg},
            ],
        )
        txt = completion.choices[0].message.content
        return txt.strip() if txt else None
    except Exception as e:  # pragma: no cover
        print(f"[pre-arrival] generation failed: {e}")
        return None
