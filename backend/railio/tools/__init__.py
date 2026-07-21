"""AI tool registry."""

from __future__ import annotations

import copy
from typing import Any, Awaitable, Callable

from .lookup_parts import lookup_parts
from .record_part_used import record_part_used
from .search_corpus import search_corpus
from .show_figure import show_figure

# OpenAI Chat Completions tool definitions (function calling).
TOOL_DEFS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "search_corpus",
            "description": (
                "Vector-search the corpus across both doc classes. Returns top-k chunks with "
                "(id, doc_class, doc_id, doc_title, source_label, page, text). Prefer manual "
                "chunks; fall back to tribal_knowledge."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "k": {"type": "number", "default": 6},
                    "doc_class_filter": {
                        "type": "string",
                        "enum": ["manual", "tribal_knowledge", "any"],
                        "default": "any",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "request_photo",
            "description": (
                "Ask the user to send a photo. Renders an inline upload prompt in the chat. "
                "Use whenever the user's words are ambiguous about a physical condition."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["prompt", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "show_figure",
            "description": (
                "Display a knowledge-base figure inline in the chat as a thumbnail the "
                "tech can tap to enlarge. Use when a chunk returned by search_corpus has "
                "a figure (diagram, exploded view, wiring schematic) that helps the tech "
                "physically locate or identify a component you're describing. Pass the "
                "chunk's id as chunk_id and the figure's index from that chunk's figures "
                "list."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "chunk_id": {"type": "number"},
                    "figure_index": {"type": "number", "default": 0},
                },
                "required": ["chunk_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_parts",
            "description": (
                "Look up parts compatible with the given unit_model and matching the query. The "
                "query is tokenized — each whitespace-separated word is matched independently "
                "against name, description, and part_number, and results are ranked by how many "
                "tokens hit. Prefer SHORT keyword queries over full phrases: use \"brake shoe\" "
                "not \"brake shoe component for the truck\", and use \"injector\" not "
                "\"fuel injector replacement\". If the first query returns no matches, retry with "
                "a single broader keyword (e.g. \"brake\", \"fuel\", \"traction\") before telling "
                "the user the part isn't stocked."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "unit_model": {
                        "type": "string",
                        "description": (
                            "The locomotive unit model to filter parts by. Use the model named "
                            "in the ticket context."
                        ),
                    },
                    "query": {"type": "string"},
                },
                "required": ["unit_model", "query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "record_part_used",
            "description": (
                "Record a part as used on this repair. Writes to ticket_parts so the "
                "sidebar and parts history reflect what the tech consumed. The ticket is "
                "bound by the runtime — pass only the part_id (from lookup_parts) and qty."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "part_id": {"type": "number"},
                    "qty": {"type": "number"},
                },
                "required": ["part_id", "qty"],
            },
        },
    },
]

# === Ticketless copilot tool set ===
# Derived by filtering the ticket TOOL_DEFS so descriptions stay in one place.
# Dropped: parse_fault_dump / record_part_used (both write ticket-scoped rows
# and there is no ticket) and request_photo (its upload endpoint requires a
# ticket, so the prompt would be unanswerable). lookup_parts is kept but its
# unit_model description is rewritten — the ticket version says "use the model
# named in the ticket context", a dangling reference with no ticket.
_TICKETLESS_EXCLUDED = {"parse_fault_dump", "record_part_used", "request_photo"}


def _copilot_tool_defs() -> list[dict[str, Any]]:
    defs: list[dict[str, Any]] = []
    for d in TOOL_DEFS:
        if d["function"]["name"] in _TICKETLESS_EXCLUDED:
            continue
        if d["function"]["name"] == "lookup_parts":
            d = copy.deepcopy(d)
            d["function"]["parameters"]["properties"]["unit_model"]["description"] = (
                "The locomotive unit model to filter parts by. Use the model from "
                "CURRENT SCOPE. If UNSCOPED, ask the user which unit or model before "
                "calling."
            )
        defs.append(d)
    return defs


COPILOT_TOOL_DEFS: list[dict[str, Any]] = _copilot_tool_defs()

# An emit callback for streaming events.
ToolEmit = Callable[[dict[str, Any]], None]


async def execute_tool(
    name: str,
    inp: dict[str, Any],
    emit: ToolEmit,
    scope: dict[str, Any] | None = None,
) -> dict[str, Any]:
    # Defense in depth: a ticket-mutating tool must never run without a ticket.
    # COPILOT_TOOL_DEFS already omits these, but a jailbreak or stale conversation
    # could still name one — fail loudly rather than writing to ticket_id = NULL.
    if name in ("parse_fault_dump", "record_part_used") and not (scope or {}).get("ticket_id"):
        return {"error": f"{name} requires a ticket; this is a ticketless session"}
    if name == "search_corpus":
        # Scope is bound by the runtime from the ticket and OVERRIDES any
        # org_id/unit_model/asset_id the model might pass — the model must not
        # pick scope (especially not its own org — that's the tenant boundary).
        args = {
            k: v for k, v in inp.items() if k not in ("org_id", "unit_model", "asset_id")
        }
        if scope:
            args["org_id"] = scope.get("org_id")
            args["unit_model"] = scope.get("unit_model")
            args["asset_id"] = scope.get("asset_id")
        return await search_corpus(**args)
    if name == "request_photo":
        emit(
            {
                "type": "request_photo",
                "prompt": str(inp.get("prompt", "")),
                "reason": str(inp.get("reason", "")),
            }
        )
        return {"ok": True, "requested": True}
    if name == "show_figure":
        # The model picks chunk_id; the runtime injects org_id so the tenant
        # boundary is enforced (the model must never pick org).
        args = {k: v for k, v in inp.items() if k != "org_id"}
        if scope:
            args["org_id"] = scope.get("org_id")
        output = await show_figure(**args)
        if output.get("ok"):
            emit(
                {
                    "type": "show_figure",
                    "chunk_id": output["chunk_id"],
                    "figure": output["figure"],
                }
            )
        return output
    if name == "lookup_parts":
        # Parts are org-private; the runtime injects the tenant's org_id.
        args = {k: v for k, v in inp.items() if k != "org_id"}
        if scope:
            args["org_id"] = scope.get("org_id")
        return await lookup_parts(**args)
    if name == "record_part_used":
        # org_id + ticket_id are bound by the runtime — the model supplies only
        # part_id and qty (it never sees the numeric ticket_id).
        args = {k: v for k, v in inp.items() if k not in ("org_id", "ticket_id")}
        if scope:
            args["org_id"] = scope.get("org_id")
            args["ticket_id"] = scope.get("ticket_id")
        return await record_part_used(emit=emit, **args)
    return {"error": f"unknown tool: {name}"}


def redact_for_model(name: str, output: dict[str, Any]) -> dict[str, Any]:
    """Strip fields the UI needs to render but the model must not see.

    A tool's output serves two consumers: the frontend (which renders it) and
    the model (which reads it back as a `tool` message). Hand the model a
    figure's storage path and it stops trusting show_figure to do the rendering
    — it prepends an invented origin and emits its own markdown image, which
    404s into a broken-image box. search_corpus already withholds paths for this
    reason; this keeps show_figure honest to the same rule. The model only needs
    to know the call succeeded.
    """
    if name == "show_figure" and isinstance(output.get("figure"), dict):
        return {
            **output,
            "figure": {k: v for k, v in output["figure"].items() if k != "path"},
        }
    return output


__all__ = ["TOOL_DEFS", "COPILOT_TOOL_DEFS", "ToolEmit", "execute_tool", "redact_for_model"]
