"""OpenAI streaming chat with tool-use accumulation.

Emits StreamEvent shapes consumed by the frontend SSE client.
"""

from __future__ import annotations

import base64
import json
from typing import Any, Callable

from .contract import Attachment, Citation, Message, ToolCall
from .messages_repo import insert_message, list_messages
from .openai_client import chat_model, get_openai
from .storage import STORAGE_URL_PREFIX, download_bytes
from .system_prompt import SYSTEM_PROMPT
from .tickets_repo import get_ticket_detail
from .tools import TOOL_DEFS, execute_tool

MAX_TOOL_ROUNDS = 8

ToolEmit = Callable[[dict[str, Any]], None]


def _read_image_b64(path: str) -> str | None:
    if not path.startswith(STORAGE_URL_PREFIX + "/"):
        return None
    storage_key = path[len(STORAGE_URL_PREFIX) + 1 :]
    data = download_bytes(storage_key)
    if not data:
        return None
    return base64.b64encode(data).decode("ascii")


async def _to_openai_messages(history: list[Message]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for m in history:
        if m.role in ("system", "tool"):
            continue
        if m.role == "assistant":
            if m.content:
                out.append({"role": "assistant", "content": m.content})
            continue
        parts: list[dict[str, Any]] = []
        if m.attachments:
            for a in m.attachments:
                if a.kind == "image" and a.path:
                    b64 = _read_image_b64(a.path)
                    if b64:
                        parts.append(
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:{a.mime};base64,{b64}"},
                            }
                        )
        parts.append({"type": "text", "text": f"[{m.role}] {m.content}"})
        out.append({"role": "user", "content": parts})
    return out


async def _build_ticket_context(ticket_id: int, org_id: int) -> str | None:
    t = await get_ticket_detail(ticket_id, org_id)
    if not t:
        return None
    lines = ["=== TICKET CONTEXT ==="]
    lines.append(
        f"Ticket: {t.short_id}"
        + (f" — {t.title}" if t.title else "")
        + f" · status: {t.status} · severity: {t.severity} · opened: {t.opened_at}"
        + (f" · closed: {t.closed_at}" if t.closed_at else "")
    )
    a = t.asset
    in_svc = f", in service since {a.in_service_date}" if a.in_service_date else ""
    last_insp = f", last inspected {a.last_inspection_at}" if a.last_inspection_at else ""
    lines.append(
        f"Asset: {a.reporting_mark} {a.road_number} — {a.unit_model}{in_svc}{last_insp}."
    )
    if t.initial_symptoms:
        lines.append(f"Initial symptoms: {t.initial_symptoms}")
    if t.initial_error_codes:
        lines.append(f"Initial error codes: {t.initial_error_codes}")
    if t.fault_dump_parsed:
        lines.append("Parsed faults:")
        for f in t.fault_dump_parsed:
            ts = f" at {f.ts}" if f.ts else ""
            lines.append(f"  - {f.code} ({f.severity}){ts} — {f.description}")
    if t.pre_arrival_summary:
        lines.append(f"Pre-arrival summary: {t.pre_arrival_summary}")
    if t.ticket_parts:
        lines.append("Parts already used on this repair:")
        for tp in t.ticket_parts:
            lines.append(f"  - part_id={tp.part_id} qty={tp.qty}")

    lines.append("======================")
    return "\n".join(lines)


async def _build_corpus_scope(ticket_id: int, org_id: int) -> dict[str, Any]:
    """Bind the corpus + parts search scope from the ticket's org and asset.

    Returned dict is passed to execute_tool so search_corpus and the parts tools
    are scoped to this tenant + unit — the model never chooses scope.
    """
    t = await get_ticket_detail(ticket_id, org_id)
    if not t or not t.asset:
        return {"org_id": org_id, "unit_model": None, "asset_id": None}
    return {"org_id": org_id, "unit_model": t.asset.unit_model, "asset_id": t.asset.id}


async def run_chat(
    *,
    ticket_id: int,
    org_id: int,
    user_role: str,
    user_content: str,
    attachments: list[Attachment],
    emit: ToolEmit,
) -> None:
    user_msg = await insert_message(
        ticket_id=ticket_id,
        role=user_role,  # type: ignore[arg-type]
        content=user_content,
        attachments=attachments if attachments else None,
    )
    emit({"type": "user_message_persisted", "message": user_msg.model_dump(by_alias=True)})

    client = get_openai()
    scope = await _build_corpus_scope(ticket_id, org_id)
    history = await list_messages(ticket_id)
    messages = await _to_openai_messages(history)

    is_first_turn = len(history) == 1
    if is_first_turn:
        ctx = await _build_ticket_context(ticket_id, org_id)
        if ctx:
            messages.insert(1, {"role": "system", "content": ctx})

    assistant_text = ""
    all_tool_calls: list[ToolCall] = []
    all_citations: list[Citation] = []

    for _round in range(MAX_TOOL_ROUNDS):
        stream = await client.chat.completions.create(
            model=chat_model(),
            messages=messages,
            tools=TOOL_DEFS,
            stream=True,
        )

        text_this_round = ""
        tool_by_index: dict[int, dict[str, str]] = {}
        finish_reason: str | None = None

        async for chunk in stream:
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            delta = choice.delta
            if delta and delta.content:
                text_this_round += delta.content
                emit({"type": "assistant_token", "delta": delta.content})
            if delta and delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index if tc.index is not None else 0
                    cur = tool_by_index.setdefault(idx, {"id": "", "name": "", "argsJson": ""})
                    if tc.id:
                        cur["id"] = tc.id
                    if tc.function:
                        if tc.function.name:
                            cur["name"] = tc.function.name
                        if tc.function.arguments:
                            cur["argsJson"] += tc.function.arguments
            if choice.finish_reason:
                finish_reason = choice.finish_reason

        assistant_text += text_this_round

        if not tool_by_index or finish_reason == "stop":
            messages.append({"role": "assistant", "content": text_this_round})
            break

        sorted_calls = sorted(tool_by_index.values(), key=lambda t: t["id"])
        assistant_message: dict[str, Any] = {
            "role": "assistant",
            "content": text_this_round or None,
            "tool_calls": [
                {
                    "id": t["id"],
                    "type": "function",
                    "function": {"name": t["name"], "arguments": t["argsJson"] or "{}"},
                }
                for t in sorted_calls
            ],
        }
        messages.append(assistant_message)

        for t in sorted_calls:
            try:
                inp = json.loads(t["argsJson"]) if t["argsJson"] else {}
            except (TypeError, ValueError):
                inp = {"_raw": t["argsJson"]}
            emit(
                {
                    "type": "tool_call_started",
                    "name": t["name"],
                    "input": inp,
                    "call_id": t["id"],
                }
            )
            try:
                output = await execute_tool(t["name"], inp, emit, scope=scope)
            except Exception as e:
                output = {"error": str(e)}
            emit({"type": "tool_call_completed", "call_id": t["id"], "output": output})

            all_tool_calls.append(ToolCall(name=t["name"], input=inp, output=output, call_id=t["id"]))

            if t["name"] == "search_corpus":
                chunks = output.get("chunks", []) if isinstance(output, dict) else []
                for c in chunks:
                    if not any(x.chunk_id == c["id"] for x in all_citations):
                        all_citations.append(
                            Citation(
                                doc_class=c["doc_class"],
                                doc_id=c["doc_id"],
                                page=c["page"],
                                source_label=c["source_label"],
                                chunk_id=c["id"],
                            )
                        )

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": t["id"],
                    "content": json.dumps(output),
                }
            )

    assistant_msg = await insert_message(
        ticket_id=ticket_id,
        role="assistant",
        content=assistant_text.strip(),
        citations=all_citations if all_citations else None,
        tool_calls=all_tool_calls if all_tool_calls else None,
    )
    emit({"type": "assistant_message_persisted", "message": assistant_msg.model_dump(by_alias=True)})
    emit({"type": "done"})
