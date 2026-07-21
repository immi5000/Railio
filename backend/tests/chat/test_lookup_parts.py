"""lookup_parts fires when the tech needs a part, scoped to the unit's model.

The unit_model assertion is the real prize here: the model can only know it from
the TICKET CONTEXT block, which is injected on the first turn only. If context
injection breaks, this is what catches it.
"""

from __future__ import annotations

import pytest

from tests.helpers.chat import expect_tool

pytestmark = [pytest.mark.live_openai, pytest.mark.db]

PROMPTS = [
    "I need to replace an injector, what do we have?",
    "Do we stock a spare air filter?",
    "What relays do we have on hand?",
    "Need a traction motor lead connector — check stock.",
]


@pytest.mark.parametrize("prompt", PROMPTS)
async def test_lookup_parts_fires(prompt, make_ticket, org_id, figure_asset, part_owners):
    run = await expect_tool(
        tool="lookup_parts",
        make_ticket=make_ticket,
        org_id=org_id,
        prompt=prompt,
        role="tech",
    )

    for inp in run.inputs("lookup_parts"):
        assert inp.get("unit_model") == figure_asset["unit_model"], (
            f"lookup_parts used unit_model {inp.get('unit_model')!r}, but this "
            f"ticket's unit is a {figure_asset['unit_model']!r}. The model reads "
            f"that from the first-turn TICKET CONTEXT — this usually means the "
            f"context block is missing or wrong."
        )
        assert isinstance(inp.get("query"), str) and inp["query"].strip()

    for out in run.outputs("lookup_parts"):
        assert isinstance(out.get("matches"), list), f"no matches list in {out!r}"
        for m in out["matches"]:
            assert isinstance(m.get("id"), int)
            assert m.get("part_number")

    # Inventory is org-exclusive — unlike the corpus there is no shared tier, so
    # any part from another org is a leak, not reference data.
    ids = [m["id"] for out in run.outputs("lookup_parts") for m in out.get("matches") or []]
    owners = await part_owners(ids)
    leaked = {pid: o for pid, o in owners.items() if o != org_id}
    assert not leaked, f"lookup_parts returned another org's parts: {leaked}"
