"""The tech's first message moves the ticket to IN_PROGRESS on its own.

This is runtime logic, not a model choice — chat_loop calls set_ticket_status
directly, and it isn't in TOOL_DEFS. So it needs no phrasing battery: one live
run proves the wiring, and the legality table itself is tested without OpenAI in
tests/api/test_status_transitions.py.
"""

from __future__ import annotations

import pytest

from tests.helpers.chat import run_prompt

pytestmark = [pytest.mark.live_openai, pytest.mark.db]


async def test_tech_first_message_starts_the_ticket(make_ticket, org_id, ticket_status):
    run = await run_prompt(
        make_ticket=make_ticket,
        org_id=org_id,
        prompt="On site at the unit now.",
        role="tech",
        ticket_kwargs={"status": "AWAITING_TECH"},
    )

    starts = run.starts("set_ticket_status")
    assert len(starts) == 1, f"expected exactly one auto-status call, got {len(starts)}"
    assert starts[0]["input"] == {"status": "IN_PROGRESS"}
    assert starts[0]["call_id"].startswith("auto_status_")
    assert run.outputs("set_ticket_status")[0] == {"ok": True, "status": "IN_PROGRESS"}
    assert await ticket_status(run.ticket_id) == "IN_PROGRESS"


async def test_auto_status_is_a_noop_once_started(make_ticket, org_id, ticket_status):
    """Already IN_PROGRESS: the illegal self-transition must not be emitted."""
    run = await run_prompt(
        make_ticket=make_ticket,
        org_id=org_id,
        prompt="Still working it.",
        role="tech",
        ticket_kwargs={"status": "IN_PROGRESS"},
    )
    assert not run.starts("set_ticket_status"), (
        "auto-status fired on a ticket that was already IN_PROGRESS"
    )
    assert await ticket_status(run.ticket_id) == "IN_PROGRESS"


async def test_dispatcher_does_not_start_the_ticket(make_ticket, org_id, ticket_status):
    run = await run_prompt(
        make_ticket=make_ticket,
        org_id=org_id,
        prompt="Opening this one up — what should the tech expect?",
        role="dispatcher",
        ticket_kwargs={"status": "AWAITING_TECH"},
    )
    assert not run.starts("set_ticket_status"), "dispatcher's message started the ticket"
    assert await ticket_status(run.ticket_id) == "AWAITING_TECH"
