"""Generate up to two tappable quick-reply chips for the tech.

Models won't reliably emit a trailing "decorative" tool call after writing their
answer (they hit finish_reason=stop and end the turn), so chips are produced by a
focused side-completion on the assistant's final message — the same pattern as
pre_arrival.py / post_repair.py — rather than as a tool the chat loop's model calls.
"""

from __future__ import annotations

import json

from .openai_client import chat_model, get_openai

_SYSTEM = """You generate up to two "Follow Up" chips for a rail-maintenance technician using a chat copilot (Railio). Given Railio's latest message to the tech, output JSON {"replies": string[]} — 0, 1, or 2 chips.

Each chip is a SHORT request the TECH taps to send back to Railio to get MORE help — ≤ 6 words, phrased in the tech's own voice. The chip text is what gets SENT, and Railio must be able to act on it (it can cite the manual, show a diagram/figure, or look up a part). Choose the flavor that fits the message:

- SHARPER HELP-ASK — drill into the step Railio just gave: "What am I looking for?", "Walk me through it", "Show me the diagram", "How do I test it?".
- PRACTICAL NEXT-MOVE — push the repair forward: "What part do I need?", "What if that's not it?", "Show the wiring diagram".

When Railio tells the tech to go physically inspect or check something they haven't done yet, prefer prep-me asks that help BEFORE they walk over: "What exactly am I looking for?", "Walk me through it", "Show me where it is".

NEVER produce:
- Acknowledgements or status updates ("On it", "Checking now", "Inspecting now", "Will report back") — useless to send.
- Statements of findings or observations ("Rail's contaminated", "Sand is low") — chips are asks, not reports.
- Anything Railio can't act on, or that just repeats what it already said.

Return {"replies": []} when the unit is fixed / back in service, or there is no useful follow-up to ask. Never more than 2. Output ONLY the JSON object."""


async def generate_suggested_replies(assistant_text: str) -> list[str]:
    text = (assistant_text or "").strip()
    if not text:
        return []
    try:
        client = get_openai()
        completion = await client.chat.completions.create(
            model=chat_model(),
            temperature=0.2,
            max_tokens=120,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": text},
            ],
        )
        raw = completion.choices[0].message.content or "{}"
        obj = json.loads(raw)
        replies = obj.get("replies") if isinstance(obj, dict) else None
        if not isinstance(replies, list):
            return []
        return [r.strip() for r in replies if isinstance(r, str) and r.strip()][:2]
    except Exception as e:  # pragma: no cover
        print(f"[suggested-replies] generation failed: {e}")
        return []
