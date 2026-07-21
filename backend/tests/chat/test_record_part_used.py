"""record_part_used fires once the tech confirms, and writes what they said.

Rule 5 only allows this after a confirmation, which naively means two live turns
per prompt. It doesn't have to: _to_openai_messages drops system/tool roles and
replays only assistant *text*, so history tool_calls are never shown to the model
anyway. Seeding one assistant message that presents the part exactly as the model
would have is a faithful reproduction of the turn it replaces, at half the cost.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from railio.db import session_scope
from tests.helpers.chat import expect_tool

pytestmark = [pytest.mark.live_openai, pytest.mark.db]

# Four confirmations: bare yes, a stated quantity, a narrative, an imperative.
PROMPTS = [
    "Yes, used one.",
    "Confirmed — took 2 of those.",
    "That's the one, installed it.",
    "Used 1, record it.",
]
# The prompt that names a number, and the number it names.
STATED_QTY = {"Confirmed — took 2 of those.": 2}


def _offer(part: dict) -> tuple[dict, ...]:
    """The assistant turn that would have presented this part to the tech."""
    return (
        dict(
            role="assistant",
            content=(
                f"Found it — {part['name']} ({part['part_number']}), part_id "
                f"{part['id']}, bin {part.get('bin_location')}, "
                f"{part.get('qty_on_hand')} on hand. Confirm and I'll record it."
            ),
        ),
    )


async def _ticket_parts(ticket_id: int) -> list[dict]:
    async with session_scope() as s:
        rows = (
            await s.execute(
                text(
                    "SELECT part_id, qty, added_via FROM ticket_parts "
                    "WHERE ticket_id = :t ORDER BY id"
                ),
                {"t": ticket_id},
            )
        ).mappings().all()
    return [dict(r) for r in rows]


async def _qty_on_hand(part_id: int) -> int:
    async with session_scope() as s:
        return (
            await s.execute(
                text("SELECT qty_on_hand FROM parts WHERE id = :id"), {"id": part_id}
            )
        ).scalar_one()


@pytest.mark.parametrize("prompt", PROMPTS)
async def test_record_part_used_fires(prompt, make_ticket, org_id, stock_part):
    before = await _qty_on_hand(stock_part["id"])

    run = await expect_tool(
        tool="record_part_used",
        make_ticket=make_ticket,
        org_id=org_id,
        prompt=prompt,
        role="tech",
        seed_history=_offer(stock_part),
    )

    inputs = run.inputs("record_part_used")
    for inp in inputs:
        assert inp.get("part_id") == stock_part["id"], (
            f"recorded part_id {inp.get('part_id')} but the offered part was "
            f"{stock_part['id']}"
        )
        qty = inp.get("qty")
        assert isinstance(qty, (int, float)) and qty > 0, f"bad qty: {qty!r}"

    if prompt in STATED_QTY:
        # Only assert an exact quantity when the tech stated one; otherwise it's
        # the model's inference and pinning it would be flaky.
        assert inputs[0]["qty"] == STATED_QTY[prompt], (
            f"tech said {STATED_QTY[prompt]}, model recorded {inputs[0]['qty']}"
        )

    for out in run.outputs("record_part_used"):
        assert out.get("ok") is True, f"record_part_used failed: {out!r}"

    rows = await _ticket_parts(run.ticket_id)
    assert rows, "tool reported ok but nothing landed in ticket_parts"
    assert all(r["added_via"] == "ai_suggestion" for r in rows), rows
    assert any(r["part_id"] == stock_part["id"] for r in rows), rows

    # Consumption is recorded against the ticket; stock is only drawn down at
    # wrap-up. If this ever fails, tests are silently eating real inventory.
    assert await _qty_on_hand(stock_part["id"]) == before, (
        "recording a part changed qty_on_hand — draw-down belongs to wrap-up only"
    )
