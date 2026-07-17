"""show_figure renders a diagram instead of just naming one.

Rule 4 forbids writing a figure label as plain text without rendering it. These
run on the figure_asset, whose model is the one with figure-bearing manuals —
on a model without them the tool is unreachable and the test would be vacuous.
"""

from __future__ import annotations

import pytest

from tests.helpers.chat import expect_tool

pytestmark = [pytest.mark.live_openai, pytest.mark.db]

# Four ways to ask for a picture: diagram, schematic, exploded view, "pull up".
PROMPTS = [
    "Show me the wiring diagram for the ground relay.",
    "I need the schematic for the lube oil system.",
    "Show me the exploded view of the injector.",
    "Pull up the diagram for the battery charging rectifier.",
]


@pytest.mark.parametrize("prompt", PROMPTS)
async def test_show_figure_fires(prompt, make_ticket, org_id, chunk_owners):
    run = await expect_tool(
        tool="show_figure",
        make_ticket=make_ticket,
        org_id=org_id,
        prompt=prompt,
        role="tech",
    )

    chunks = run.searched_chunks()
    for inp in run.inputs("show_figure"):
        cid = inp.get("chunk_id")
        assert isinstance(cid, int), f"non-int chunk_id: {cid!r}"
        # Rule 4: only figures that actually came back from a search this run.
        assert cid in chunks, (
            f"show_figure({cid}) — that chunk was never returned by search_corpus "
            f"this run (returned: {sorted(chunks)}). The model invented it."
        )
        idx = inp.get("figure_index", 0)
        assert isinstance(idx, int), f"non-int figure_index: {idx!r}"
        figures = chunks[cid].get("figures") or []
        assert 0 <= idx < len(figures), (
            f"figure_index {idx} out of range for chunk {cid}, which has "
            f"{len(figures)} figure(s)"
        )

    for out in run.outputs("show_figure"):
        assert out.get("ok") is True, f"show_figure failed: {out!r}"

    events = run.of_type("show_figure")
    assert events, "tool ran but no show_figure event reached the stream"
    for e in events:
        assert e["figure"].get("path"), f"figure event with no path: {e!r}"

    # The model can only learn a figure exists from search_corpus's metadata.
    search_at = run.first_index("search_corpus")
    assert search_at is not None, "showed a figure without searching first"
    assert search_at < run.first_index("show_figure")

    # show_figure takes a model-supplied chunk_id, so unlike search_corpus it has
    # to enforce the tenant boundary itself.
    owners = await chunk_owners(i["chunk_id"] for i in run.inputs("show_figure"))
    leaked = {cid: o for cid, o in owners.items() if o is not None and o != org_id}
    assert not leaked, f"show_figure rendered another org's chunk: {leaked}"
