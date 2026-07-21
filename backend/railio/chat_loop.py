"""OpenAI streaming chat with tool-use accumulation.

Emits StreamEvent shapes consumed by the frontend SSE client.
"""

from __future__ import annotations

import base64
import json
from datetime import date, timedelta
from typing import Any, Callable

from .contract import (
    INSPECTION_INTERVALS,
    Attachment,
    Citation,
    Message,
    ToolCall,
)
from .messages_repo import insert_message, list_messages
from .openai_client import chat_model, get_openai
from .storage import STORAGE_URL_PREFIX, download_bytes
from .suggested_replies import generate_suggested_replies
from .system_prompt import COPILOT_SYSTEM_PROMPT, SYSTEM_PROMPT
from .tickets_repo import get_ticket_detail
from .tools import COPILOT_TOOL_DEFS, TOOL_DEFS, execute_tool, redact_for_model
from .tools.set_ticket_status import set_ticket_status

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


def _inspection_summary(a) -> str:
    """One readable line of FRA periodic-inspection status + OOS for the asset."""
    today = date.today()
    parts: list[str] = []
    for field, (label, interval) in INSPECTION_INTERVALS.items():
        last = getattr(a, field, None)
        if not last:
            parts.append(f"{label}: no record")
            continue
        try:
            last_d = date.fromisoformat(last[:10])
        except ValueError:
            parts.append(f"{label}: last {last}")
            continue
        due = last_d + timedelta(days=interval)
        flag = " (OVERDUE)" if due < today else ""
        parts.append(f"{label}: last {last_d.isoformat()}, next due {due.isoformat()}{flag}")
    summary = "FRA inspections — " + "; ".join(parts) + "."
    if a.out_of_service:
        since = ""
        if a.oos_since:
            try:
                down = (today - date.fromisoformat(a.oos_since[:10])).days
                since = f" since {a.oos_since[:10]} ({down} days)"
            except ValueError:
                since = f" since {a.oos_since}"
        summary += f" OUT OF SERVICE{since}."
    return summary


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
    lines.append(
        f"Asset: {a.reporting_mark} {a.road_number} — {a.unit_model}{in_svc}."
    )
    lines.append(_inspection_summary(a))
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
    """Bind the runtime scope from the ticket's org and asset.

    Returned dict is passed to execute_tool so search_corpus and the parts tools
    are scoped to this tenant + unit, and so the ticket-mutating tools target this
    ticket — the model never chooses scope (and never sees the numeric ticket_id).
    """
    t = await get_ticket_detail(ticket_id, org_id)
    if not t or not t.asset:
        return {"org_id": org_id, "unit_model": None, "asset_id": None, "ticket_id": ticket_id}
    return {
        "org_id": org_id,
        "unit_model": t.asset.unit_model,
        "asset_id": t.asset.id,
        "ticket_id": ticket_id,
    }


async def _run_tool_loop(
    client: Any,
    messages: list[dict[str, Any]],
    tool_defs: list[dict[str, Any]],
    scope: dict[str, Any],
    emit: ToolEmit,
) -> tuple[str, list[ToolCall], list[Citation]]:
    """Stream the model, run any tool calls, and loop until it stops.

    Shared by the ticket chat and the ticketless copilot — the only things that
    differ between them are the tool_defs and the scope, both passed in. Returns
    the accumulated assistant text, tool calls, and corpus citations.
    """
    assistant_text = ""
    all_tool_calls: list[ToolCall] = []
    all_citations: list[Citation] = []

    for _round in range(MAX_TOOL_ROUNDS):
        stream = await client.chat.completions.create(
            model=chat_model(),
            messages=messages,
            tools=tool_defs,
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
                    "content": json.dumps(redact_for_model(t["name"], output)),
                }
            )

    return assistant_text, all_tool_calls, all_citations


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

    # The tech engaging the ticket starts the work. set_ticket_status enforces the legal
    # table, so this is a no-op unless the ticket is currently AWAITING_TECH (i.e. fires
    # exactly once, on the tech's first message).
    if user_role == "tech":
        status_result = await set_ticket_status(ticket_id, "IN_PROGRESS")
        if status_result.get("ok"):
            call_id = f"auto_status_{user_msg.id}"
            emit({
                "type": "tool_call_started",
                "name": "set_ticket_status",
                "input": {"status": "IN_PROGRESS"},
                "call_id": call_id,
            })
            emit({"type": "tool_call_completed", "call_id": call_id, "output": status_result})

    client = get_openai()
    scope = await _build_corpus_scope(ticket_id, org_id)
    history = await list_messages(ticket_id)
    messages = await _to_openai_messages(history)

    is_first_turn = len(history) == 1
    if is_first_turn:
        ctx = await _build_ticket_context(ticket_id, org_id)
        if ctx:
            messages.insert(1, {"role": "system", "content": ctx})

    assistant_text, all_tool_calls, all_citations = await _run_tool_loop(
        client, messages, TOOL_DEFS, scope, emit
    )

    # Quick-reply chips: a focused side-call on the final answer (the model won't
    # reliably emit a trailing tool call). Tech-facing only. Emitted live AND
    # persisted as a synthetic suggest_replies tool_call so the frontend renders
    # and reconstructs them exactly like show_figure — no new Message field.
    if user_role == "tech":
        replies = await generate_suggested_replies(assistant_text)
        if replies:
            emit({"type": "suggest_replies", "replies": replies})
            all_tool_calls.append(
                ToolCall(
                    name="suggest_replies",
                    input={},
                    output={"ok": True, "replies": replies},
                    call_id=f"suggest_{user_msg.id}",
                )
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


# === Ticketless copilot ===


async def _build_scope_context(scope: dict[str, Any]) -> str:
    """CURRENT SCOPE block, rebuilt EVERY turn.

    Unlike a ticket's fixed asset, copilot scope is user-mutable mid-conversation,
    so first-turn-only injection would leave a stale unit anchoring the model after
    the user switches. Injected as the last system message before the newest user
    turn so recency makes it dominate any earlier scope statement.
    """
    from .assets_repo import list_assets

    org_id = scope.get("org_id")
    asset_id = scope.get("asset_id")
    unit_model = scope.get("unit_model")

    header = "=== CURRENT SCOPE ==="
    footer = "======================"

    if asset_id:
        assets = await list_assets(org_id) if org_id else []
        a = next((x for x in assets if x.id == asset_id), None)
        if a:
            lines = [
                header,
                f"Unit: {a.reporting_mark} {a.road_number} — {a.unit_model}.",
                _inspection_summary(a),
                "You have this unit's manuals, history, and inspection status. Scope "
                "everything to this unit.",
                footer,
            ]
            return "\n".join(lines)

    if unit_model:
        assets = await list_assets(org_id) if org_id else []
        n = sum(1 for x in assets if x.unit_model == unit_model)
        return "\n".join([
            header,
            f"Model: {unit_model} (fleet-wide{f', {n} units' if n else ''}). No single "
            "unit selected — you have this model's manuals but no unit-specific "
            "history or inspection status.",
            footer,
        ])

    return "\n".join([
        header,
        "UNSCOPED — no unit or model selected. Corpus search spans every model in "
        "this org; a result may be from a different model than the user's. Name the "
        "model each fact came from, and ask the user to pick a unit or model in the "
        "sidebar when the model matters.",
        footer,
    ])


async def run_copilot_chat(
    *,
    conversation_id: int,
    org_id: int,
    scope: dict[str, Any],
    user_role: str,
    user_content: str,
    attachments: list[Attachment],
    emit: ToolEmit,
) -> None:
    """The ticketless copilot turn. Mirrors run_chat minus the ticket machinery:
    persists to copilot_messages (no hash chain), never touches ticket status, uses
    the filtered COPILOT_TOOL_DEFS, and re-injects the scope block on every turn.
    """
    from .copilot_repo import insert_copilot_message, list_copilot_messages

    user_msg = await insert_copilot_message(
        conversation_id=conversation_id,
        role=user_role,  # type: ignore[arg-type]
        content=user_content,
        attachments=attachments if attachments else None,
    )
    emit({"type": "user_message_persisted", "message": user_msg.model_dump(by_alias=True)})

    client = get_openai()
    history = await list_copilot_messages(conversation_id)
    messages = await _to_openai_messages(history)
    # Swap the ticket system prompt for the copilot one (index 0 is always the
    # system prompt from _to_openai_messages).
    messages[0] = {"role": "system", "content": COPILOT_SYSTEM_PROMPT}
    # Scope block re-injected every turn as the last system message before the
    # newest user turn (which is messages[-1]).
    scope_ctx = await _build_scope_context(scope)
    messages.insert(len(messages) - 1, {"role": "system", "content": scope_ctx})

    assistant_text, all_tool_calls, all_citations = await _run_tool_loop(
        client, messages, COPILOT_TOOL_DEFS, scope, emit
    )

    if user_role == "tech":
        replies = await generate_suggested_replies(assistant_text)
        if replies:
            emit({"type": "suggest_replies", "replies": replies})
            all_tool_calls.append(
                ToolCall(
                    name="suggest_replies",
                    input={},
                    output={"ok": True, "replies": replies},
                    call_id=f"suggest_{user_msg.id}",
                )
            )

    assistant_msg = await insert_copilot_message(
        conversation_id=conversation_id,
        role="assistant",
        content=assistant_text.strip(),
        citations=all_citations if all_citations else None,
        tool_calls=all_tool_calls if all_tool_calls else None,
    )
    emit({"type": "assistant_message_persisted", "message": assistant_msg.model_dump(by_alias=True)})
    emit({"type": "done"})
