"""Ticketless copilot conversations + messages.

Deliberately separate from messages_repo: the `messages` table is a
tamper-evident SHA-256 hash chain for FRA-regulated repair records, and
verify_chain.py only audits rows that belong to a ticket. Advisory browsing has
no repair, no asset, and no regulatory weight, so it lives here with no chain —
keeping the audit log exclusively for what it's for.

Copilot rows reuse the `Message` shape (so the SSE pipeline and ChatPane render
them unchanged), with ticket_id=0 and empty prev_hash/hash — none of which the
frontend reads for rendering.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from .contract import (
    Attachment,
    Citation,
    CopilotConversation,
    Message,
    Role,
    ToolCall,
)
from .db import session_scope


def _iso_now() -> str:
    # JS new Date().toISOString() → "2026-05-22T17:38:02.642Z" (ms precision, Z).
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(now.microsecond / 1000):03d}Z"


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


def _conversation_from_row(r: Any) -> CopilotConversation:
    return CopilotConversation(
        id=r["id"],
        org_id=r["org_id"],
        created_by=r["created_by"],
        title=r["title"],
        asset_id=r["asset_id"],
        unit_model=r["unit_model"],
        created_at=r["created_at"],
        updated_at=r["updated_at"],
    )


async def create_conversation(
    org_id: int, created_by: str, title: Optional[str] = None
) -> CopilotConversation:
    now = _iso_now()
    async with session_scope() as session:
        row = (
            await session.execute(
                text(
                    """
                    INSERT INTO copilot_conversations
                        (org_id, created_by, title, created_at, updated_at)
                    VALUES (:org_id, :created_by, :title, :now, :now)
                    RETURNING id, org_id, created_by, title, asset_id, unit_model,
                              created_at, updated_at
                    """
                ),
                {"org_id": org_id, "created_by": created_by, "title": title, "now": now},
            )
        ).mappings().one()
    return _conversation_from_row(row)


async def list_conversations(
    org_id: int, created_by: str, limit: int = 30
) -> list[CopilotConversation]:
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT id, org_id, created_by, title, asset_id, unit_model,
                           created_at, updated_at
                    FROM copilot_conversations
                    WHERE org_id = :org_id AND created_by = :created_by
                    ORDER BY updated_at DESC
                    LIMIT :limit
                    """
                ),
                {"org_id": org_id, "created_by": created_by, "limit": limit},
            )
        ).mappings().all()
    return [_conversation_from_row(r) for r in rows]


async def get_conversation(
    conv_id: int, org_id: int, created_by: str
) -> Optional[CopilotConversation]:
    """Ownership check: returns None unless the conversation belongs to this
    org AND this user. Every route that touches a conversation goes through here."""
    async with session_scope() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT id, org_id, created_by, title, asset_id, unit_model,
                           created_at, updated_at
                    FROM copilot_conversations
                    WHERE id = :id AND org_id = :org_id AND created_by = :created_by
                    """
                ),
                {"id": conv_id, "org_id": org_id, "created_by": created_by},
            )
        ).mappings().one_or_none()
    return _conversation_from_row(row) if row else None


async def update_conversation_scope(
    conv_id: int, asset_id: Optional[int], unit_model: Optional[str]
) -> None:
    async with session_scope() as session:
        await session.execute(
            text(
                """
                UPDATE copilot_conversations
                SET asset_id = :asset_id, unit_model = :unit_model, updated_at = :now
                WHERE id = :id
                """
            ),
            {
                "id": conv_id,
                "asset_id": asset_id,
                "unit_model": unit_model,
                "now": _iso_now(),
            },
        )


def _message_from_row(r: Any) -> Message:
    return Message(
        id=r["id"],
        ticket_id=0,  # copilot rows have no ticket
        role=r["role"],
        content=r["content"],
        citations=[Citation(**c) for c in r["citations"]] if r["citations"] else None,
        attachments=[Attachment(**a) for a in r["attachments"]] if r["attachments"] else None,
        tool_calls=[ToolCall(**t) for t in r["tool_calls"]] if r["tool_calls"] else None,
        created_at=r["created_at"],
        prev_hash=None,
        hash="",
    )


async def insert_copilot_message(
    *,
    conversation_id: int,
    role: Role,
    content: str,
    citations: Optional[list[dict[str, Any]] | list[Citation]] = None,
    attachments: Optional[list[dict[str, Any]] | list[Attachment]] = None,
    tool_calls: Optional[list[dict[str, Any]] | list[ToolCall]] = None,
) -> Message:
    created_at = _iso_now()
    citations_json = _to_jsonable(citations)
    attachments_json = _to_jsonable(attachments)
    tool_calls_json = _to_jsonable(tool_calls)

    stmt = (
        text(
            """
            INSERT INTO copilot_messages (
                conversation_id, role, content, citations, attachments, tool_calls,
                created_at
            )
            VALUES (
                :conversation_id, :role, :content, :citations, :attachments,
                :tool_calls, :created_at
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

    async with session_scope() as session:
        new_id = (
            await session.execute(
                stmt,
                {
                    "conversation_id": conversation_id,
                    "role": role,
                    "content": content,
                    "citations": citations_json,
                    "attachments": attachments_json,
                    "tool_calls": tool_calls_json,
                    "created_at": created_at,
                },
            )
        ).scalar_one()
        # Bump the parent's updated_at so the history list sorts by recency.
        await session.execute(
            text("UPDATE copilot_conversations SET updated_at = :now WHERE id = :id"),
            {"id": conversation_id, "now": created_at},
        )

    return Message(
        id=int(new_id),
        ticket_id=0,
        role=role,
        content=content,
        citations=[Citation(**c) for c in citations_json] if citations_json else None,
        attachments=[Attachment(**a) for a in attachments_json] if attachments_json else None,
        tool_calls=[ToolCall(**t) for t in tool_calls_json] if tool_calls_json else None,
        created_at=created_at,
        prev_hash=None,
        hash="",
    )


async def list_copilot_messages(conversation_id: int) -> list[Message]:
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT id, role, content, citations, attachments, tool_calls,
                           created_at
                    FROM copilot_messages WHERE conversation_id = :cid ORDER BY id ASC
                    """
                ),
                {"cid": conversation_id},
            )
        ).mappings().all()
    return [_message_from_row(r) for r in rows]
