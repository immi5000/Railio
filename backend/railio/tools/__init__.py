"""AI tool registry."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from .lookup_parts import lookup_parts
from .parse_fault_dump import parse_fault_dump
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
            "name": "parse_fault_dump",
            "description": (
                "Parse a raw locomotive diagnostic dump into structured "
                "{code, ts, severity, description}[]. Persists to tickets.fault_dump_parsed. "
                "Call once on dispatcher intake. The ticket is bound by the runtime."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "raw_text": {"type": "string"},
                },
                "required": ["raw_text"],
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

# An emit callback for streaming events.
ToolEmit = Callable[[dict[str, Any]], None]


async def execute_tool(
    name: str,
    inp: dict[str, Any],
    emit: ToolEmit,
    scope: dict[str, Any] | None = None,
) -> dict[str, Any]:
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
    if name == "parse_fault_dump":
        # ticket_id is bound by the runtime — the model never picks which ticket.
        args = {k: v for k, v in inp.items() if k != "ticket_id"}
        if scope:
            args["ticket_id"] = scope.get("ticket_id")
        return await parse_fault_dump(**args)
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


__all__ = ["TOOL_DEFS", "ToolEmit", "execute_tool"]
