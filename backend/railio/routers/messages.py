"""SSE-streaming chat endpoint."""

from __future__ import annotations

import asyncio
import json
import os
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from ..chat_loop import run_chat
from ..config import get_settings
from ..contract import Attachment, Organization, SendMessageBody
from ..org_context import get_current_org, get_current_user
from ..posthog_client import get_posthog
from ..rate_limit_repo import check_and_record
from ..tickets_repo import resolve_ticket_id

router = APIRouter()


async def enforce_chat_rate_limit(user: dict = Depends(get_current_user)) -> None:
    """429 when the user exceeds the sliding-window message rate.

    Runs as a route dependency so the limit is enforced BEFORE the background
    chat task (and any OpenAI work) starts. get_current_user is already resolved
    for this route, so the JWT is verified once per request.
    """
    s = get_settings()
    retry = await check_and_record(
        user["supabase_user_id"],
        s.rate_limit_per_user_per_min,
        s.rate_limit_window_seconds,
    )
    if retry is not None:
        raise HTTPException(
            status_code=429,
            detail="You're sending messages too fast. Please wait a moment.",
            headers={"Retry-After": str(retry)},
        )


def _guess_mime(ext: str) -> str:
    ext = ext.lower()
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".pdf": "application/pdf",
    }.get(ext, "application/octet-stream")


@router.post("/{ticket_ref}/messages")
async def post_message(
    ticket_ref: str,
    body: SendMessageBody,
    org: Organization = Depends(get_current_org),
    user: dict = Depends(get_current_user),
    _rl: None = Depends(enforce_chat_rate_limit),
) -> StreamingResponse:
    org_id = org.id
    ticket_id = await resolve_ticket_id(ticket_ref, org_id)
    if ticket_id is None:
        raise HTTPException(status_code=404, detail="not found")
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
            event="message_sent",
            properties={
                "role": body.role,
                "has_attachments": bool(body.attachment_paths),
                "attachment_count": len(body.attachment_paths or []),
            },
        )

    queue: asyncio.Queue[dict | None] = asyncio.Queue()

    def emit(ev: dict) -> None:
        queue.put_nowait(ev)

    async def runner() -> None:
        try:
            await run_chat(
                ticket_id=ticket_id,
                org_id=org_id,
                user_role=body.role,
                user_content=body.content,
                attachments=attachments,
                emit=emit,
            )
        except Exception as e:
            emit({"type": "error", "error": str(e)})
        finally:
            queue.put_nowait(None)  # sentinel: stream complete

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
