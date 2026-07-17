"""request_photo fires before advice, when the tech's description is ambiguous.

Rule 3: leaks, smoke, oil sheen, fitment, surface damage. All four prompts
describe something the model cannot resolve from words alone.
"""

from __future__ import annotations

import pytest

from tests.helpers.chat import expect_tool

pytestmark = [pytest.mark.live_openai, pytest.mark.db]

PROMPTS = [
    "There's oil pooling under the engine, what do I do?",
    "I see a sheen around the governor, is that bad?",
    "Something's smoking near the traction motor blower.",
    "There's damage on the truck frame — how do I fix it?",
]


@pytest.mark.parametrize("prompt", PROMPTS)
async def test_request_photo_fires(prompt, make_ticket, org_id):
    run = await expect_tool(
        tool="request_photo",
        make_ticket=make_ticket,
        org_id=org_id,
        prompt=prompt,
        role="tech",
    )

    for inp in run.inputs("request_photo"):
        assert isinstance(inp.get("prompt"), str) and inp["prompt"].strip(), (
            f"empty photo prompt: {inp!r}"
        )
        assert isinstance(inp.get("reason"), str) and inp["reason"].strip(), (
            f"empty photo reason: {inp!r}"
        )

    for out in run.outputs("request_photo"):
        assert out == {"ok": True, "requested": True}, f"unexpected output {out!r}"

    # The UI renders the inline uploader off this event, not the tool call.
    events = run.of_type("request_photo")
    assert events, "tool ran but no request_photo event reached the stream"
    inputs = run.inputs("request_photo")
    assert {(e["prompt"], e["reason"]) for e in events} == {
        (i["prompt"], i["reason"]) for i in inputs
    }, "request_photo event text doesn't match the tool input"

    # Rule 3 is really about ordering: don't commit to a fix before you can see
    # what you're fixing.
    photo_at = run.first_index("request_photo")
    record_at = run.first_index("record_part_used")
    assert record_at is None or photo_at < record_at, (
        "recorded a part before asking for the photo that would confirm the fault\n"
        + run.report()
    )
