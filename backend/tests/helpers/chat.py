"""Driving run_chat from a test.

run_chat has no HTTP or auth coupling and takes an injected synchronous emit, so
a test drives the real loop against the real model with `list.append` as the
emit. What it does need is a live DB and a live OPENAI_API_KEY.
"""

from __future__ import annotations

import pytest

from railio.chat_loop import run_chat
from railio.messages_repo import insert_message

from .chain import assert_chain_intact
from .events import ChatRun, assert_stream_contract


async def run_prompt(
    *,
    make_ticket,
    org_id: int,
    prompt: str,
    role: str = "dispatcher",
    ticket_kwargs: dict | None = None,
    seed_history: tuple[dict, ...] = (),
) -> ChatRun:
    """One live turn on a fresh ticket, with the cross-cutting contract checked."""
    kwargs = dict(ticket_kwargs or {})
    if role == "tech":
        kwargs.setdefault("status", "AWAITING_TECH")
    ticket_id = await make_ticket(**kwargs)

    for m in seed_history:
        await insert_message(ticket_id=ticket_id, **m)

    run = ChatRun(prompt=prompt, ticket_id=ticket_id, role=role)
    await run_chat(
        ticket_id=ticket_id,
        org_id=org_id,
        user_role=role,
        user_content=prompt,
        attachments=[],
        emit=run.events.append,
    )
    assert_stream_contract(run)
    await assert_chain_intact(ticket_id)
    return run


async def expect_tool(*, tool: str, **kw) -> ChatRun:
    """Assert the model called `tool`, allowing exactly one retry.

    Tool choice is probabilistic, so a single miss is noise and two is a signal.
    The retry runs on a *fresh* ticket: re-running the same one would replay the
    failed exchange as history and bias the retry toward repeating itself.
    """
    attempts: list[ChatRun] = []
    for _ in range(2):
        run = await run_prompt(**kw)
        if run.called(tool):
            return run
        attempts.append(run)
    pytest.fail(_miss_report(tool, kw["prompt"], attempts), pytrace=False)


def _miss_report(tool: str, prompt: str, attempts: list[ChatRun]) -> str:
    lines = [
        f"`{tool}` never fired — 2 attempts, a fresh ticket each time.",
        f"  prompt: {prompt!r}",
        "",
    ]
    for i, run in enumerate(attempts, 1):
        lines.append(f"  attempt {i}:")
        lines.append(run.report())
        lines.append("")
    return "\n".join(lines)
