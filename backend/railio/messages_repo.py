"""Append-only messages with sha256 hash chain.

The payload key order (ticket_id, role, content, citations, attachments,
tool_calls, created_at) is part of the hash input. Changing the order breaks
verification of previously-written rows.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from .contract import Attachment, Citation, Message, Role, ToolCall
from .db import session_scope
from .hash import chain_hash


def _iso_now() -> str:
    # JS new Date().toISOString() → "2026-05-22T17:38:02.642Z" (ms precision, Z suffix)
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + (
        f"{int(datetime.now(timezone.utc).microsecond / 1000):03d}Z"
    )


async def insert_message(
    *,
    ticket_id: int,
    role: Role,
    content: str,
    citations: Optional[list[dict[str, Any]] | list[Citation]] = None,
    attachments: Optional[list[dict[str, Any]] | list[Attachment]] = None,
    tool_calls: Optional[list[dict[str, Any]] | list[ToolCall]] = None,
) -> Message:
    created_at = _iso_now()

    def _to_jsonable(v: Any) -> Any:
        if v is None:
            return None
        out: list[Any] = []
        for item in v:
            if hasattr(item, "model_dump"):
                out.append(item.model_dump(by_alias=True, exclude_none=False))
            else:
                out.append(item)
        return out

    citations_json = _to_jsonable(citations)
    attachments_json = _to_jsonable(attachments)
    tool_calls_json = _to_jsonable(tool_calls)

    async with session_scope() as session:
        prev = (
            await session.execute(
                text("SELECT hash FROM messages WHERE ticket_id = :tid ORDER BY id DESC LIMIT 1"),
                {"tid": ticket_id},
            )
        ).scalar_one_or_none()

        # Key order is part of the hash input — see module docstring.
        payload = {
            "ticket_id": ticket_id,
            "role": role,
            "content": content,
            "citations": citations_json,
            "attachments": attachments_json,
            "tool_calls": tool_calls_json,
            "created_at": created_at,
        }
        hash_ = chain_hash(prev, payload)

        stmt = (
            text(
                """
                INSERT INTO messages (
                    ticket_id, role, content, citations, attachments, tool_calls,
                    created_at, prev_hash, hash
                )
                VALUES (
                    :ticket_id, :role, :content, :citations, :attachments, :tool_calls,
                    :created_at, :prev_hash, :hash
                )
                RETURNING id
                """
            )
            .bindparams(
                bindparam("citations", type_=JSONB),
                bindparam("attachments", type_=JSONB),
                bindparam("tool_calls", type_=JSONB),
            )
        )
        new_id = (
            await session.execute(
                stmt,
                {
                    "ticket_id": ticket_id,
                    "role": role,
                    "content": content,
                    "citations": citations_json,
                    "attachments": attachments_json,
                    "tool_calls": tool_calls_json,
                    "created_at": created_at,
                    "prev_hash": prev,
                    "hash": hash_,
                },
            )
        ).scalar_one()

    return Message(
        id=int(new_id),
        ticket_id=ticket_id,
        role=role,
        content=content,
        citations=[Citation(**c) for c in citations_json] if citations_json else None,
        attachments=[Attachment(**a) for a in attachments_json] if attachments_json else None,
        tool_calls=[ToolCall(**t) for t in tool_calls_json] if tool_calls_json else None,
        created_at=created_at,
        prev_hash=prev,
        hash=hash_,
    )


async def list_messages(ticket_id: int) -> list[Message]:
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT id, ticket_id, role, content, citations, attachments,
                           tool_calls, created_at, prev_hash, hash
                    FROM messages WHERE ticket_id = :tid ORDER BY id ASC
                    """
                ),
                {"tid": ticket_id},
            )
        ).mappings().all()

    out: list[Message] = []
    for r in rows:
        out.append(
            Message(
                id=r["id"],
                ticket_id=r["ticket_id"],
                role=r["role"],
                content=r["content"],
                citations=[Citation(**c) for c in r["citations"]] if r["citations"] else None,
                attachments=[Attachment(**a) for a in r["attachments"]] if r["attachments"] else None,
                tool_calls=[ToolCall(**t) for t in r["tool_calls"]] if r["tool_calls"] else None,
                created_at=r["created_at"],
                prev_hash=r["prev_hash"],
                hash=r["hash"],
            )
        )
    return out
