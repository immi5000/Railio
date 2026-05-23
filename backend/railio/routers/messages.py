"""SSE-streaming chat endpoint."""

from __future__ import annotations

import asyncio
import json
import os
from typing import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..chat_loop import run_chat
from ..contract import Attachment, SendMessageBody

router = APIRouter()


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


@router.post("/{ticket_id}/messages")
async def post_message(ticket_id: int, body: SendMessageBody) -> StreamingResponse:
    attachments: list[Attachment] = []
    for p in body.attachment_paths or []:
        ext = os.path.splitext(p)[1].lower()
        mime = _guess_mime(ext)
        kind = "pdf" if mime == "application/pdf" else "image"
        attachments.append(Attachment(kind=kind, path=p, mime=mime))  # type: ignore[arg-type]

    queue: asyncio.Queue[dict | None] = asyncio.Queue()

    def emit(ev: dict) -> None:
        queue.put_nowait(ev)

    async def runner() -> None:
        try:
            await run_chat(
                ticket_id=ticket_id,
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
