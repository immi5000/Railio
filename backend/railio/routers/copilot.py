"""Ticketless Railio Copilot: conversations + SSE-streaming chat.

The chat has no ticket, so scope is chosen by the client (an asset or a model) —
but the SERVER re-derives it from the verified JWT org and decides what's real.
A client-supplied org is never trusted (get_current_org ignores X-Org-Id), and a
client-supplied unit_model is only honored if it exists in this org's data.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import text

from ..assets_repo import list_assets
from ..chat_loop import run_copilot_chat
from ..contract import (
    Attachment,
    CopilotConversation,
    CopilotConversationDetail,
    CopilotMessageBody,
    Organization,
)
from ..copilot_repo import (
    create_conversation,
    get_conversation,
    insert_copilot_message,  # noqa: F401  (kept for symmetry / future use)
    list_conversations,
    list_copilot_messages,
    update_conversation_scope,
)
from ..db import session_scope
from ..org_context import get_current_org, get_current_user
from ..posthog_client import get_posthog
from ..routers.messages import _guess_mime, enforce_chat_rate_limit

router = APIRouter()


async def _valid_unit_model(org_id: int, unit_model: str) -> bool:
    """True if the model exists in this org's data — either on an asset or as a
    manual chunk (org-owned or shared CFR). Rejects an invented model string."""
    async with session_scope() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT 1
                    FROM assets
                    WHERE org_id = :org AND unit_model = :m
                    UNION ALL
                    SELECT 1
                    FROM corpus_chunks
                    WHERE unit_model = :m AND (org_id = :org OR org_id IS NULL)
                    LIMIT 1
                    """
                ),
                {"org": org_id, "m": unit_model},
            )
        ).first()
    return row is not None


async def _resolve_scope(body: CopilotMessageBody, org_id: int) -> dict[str, Any]:
    """Re-derive scope server-side. The client names an asset or a model; the
    server decides whether it exists in this org and what its unit_model is. A
    cross-org asset_id resolves to nothing (404), so scope can never straddle the
    tenant boundary. ticket_id is always None, which disarms the ticket tools."""
    scope: dict[str, Any] = {
        "org_id": org_id,
        "unit_model": None,
        "asset_id": None,
        "ticket_id": None,
    }
    if body.asset_id is not None:
        assets = await list_assets(org_id)  # already org-filtered
        a = next((x for x in assets if x.id == body.asset_id), None)
        if a is None:
            raise HTTPException(status_code=404, detail="asset not found")
        scope["asset_id"] = a.id
        scope["unit_model"] = a.unit_model  # from the DB row, never the client
    elif body.unit_model:
        if not await _valid_unit_model(org_id, body.unit_model):
            raise HTTPException(status_code=400, detail="unknown unit_model")
        scope["unit_model"] = body.unit_model
    return scope


@router.post("/conversations")
async def create_copilot_conversation(
    org: Organization = Depends(get_current_org),
    user: dict = Depends(get_current_user),
) -> CopilotConversation:
    return await create_conversation(org.id, user["supabase_user_id"])


@router.get("/conversations")
async def list_copilot_conversations(
    org: Organization = Depends(get_current_org),
    user: dict = Depends(get_current_user),
) -> list[CopilotConversation]:
    return await list_conversations(org.id, user["supabase_user_id"])


@router.get("/conversations/{conv_id}")
async def get_copilot_conversation(
    conv_id: int,
    org: Organization = Depends(get_current_org),
    user: dict = Depends(get_current_user),
) -> CopilotConversationDetail:
    conv = await get_conversation(conv_id, org.id, user["supabase_user_id"])
    if conv is None:
        raise HTTPException(status_code=404, detail="not found")
    messages = await list_copilot_messages(conv_id)
    return CopilotConversationDetail(**conv.model_dump(), messages=messages)


@router.post("/conversations/{conv_id}/messages")
async def post_copilot_message(
    conv_id: int,
    body: CopilotMessageBody,
    org: Organization = Depends(get_current_org),
    user: dict = Depends(get_current_user),
    _rl: None = Depends(enforce_chat_rate_limit),
) -> StreamingResponse:
    org_id = org.id
    conv = await get_conversation(conv_id, org_id, user["supabase_user_id"])
    if conv is None:
        raise HTTPException(status_code=404, detail="not found")

    scope = await _resolve_scope(body, org_id)
    # Remember the last scope on the conversation so the sidebar restores on reload.
    await update_conversation_scope(conv_id, scope["asset_id"], scope["unit_model"])

    attachments: list[Attachment] = []
    for p in body.attachment_paths or []:
        ext = os.path.splitext(p)[1].lower()
        mime = _guess_mime(ext)
        kind = "pdf" if mime == "application/pdf" else "image"
        attachments.append(Attachment(kind=kind, path=p, mime=mime))  # type: ignore[arg-type]

    ph = get_posthog()
    if ph:
        ph.capture(
            distinct_id=user["supabase_user_id"],
            event="copilot_message_sent",
            properties={
                "role": body.role,
                "scoped_asset": body.asset_id is not None,
                "scoped_model": bool(body.unit_model) and body.asset_id is None,
            },
        )

    queue: asyncio.Queue[dict | None] = asyncio.Queue()

    def emit(ev: dict) -> None:
        queue.put_nowait(ev)

    async def runner() -> None:
        try:
            await run_copilot_chat(
                conversation_id=conv_id,
                org_id=org_id,
                scope=scope,
                user_role=body.role,
                user_content=body.content,
                attachments=attachments,
                emit=emit,
            )
        except Exception as e:
            emit({"type": "error", "error": str(e)})
        finally:
            queue.put_nowait(None)

    asyncio.create_task(runner())

    async def gen() -> AsyncIterator[bytes]:
        while True:
            ev = await queue.get()
            if ev is None:
                return
            yield f"data: {json.dumps(ev)}\n\n".encode("utf-8")

    return StreamingResponse(
        gen(),
        media_type="text/event-stream; charset=utf-8",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
