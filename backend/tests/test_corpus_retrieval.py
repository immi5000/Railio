"""Retrieval itself, with no model in the loop.

search_corpus is called directly with fixed queries, so these are deterministic
and free. That split matters: search_corpus swallows every query exception and
returns an empty chunk list, which makes a DB problem look exactly like "the
manual doesn't cover this" — and the model then refuses in good faith. Testing
retrieval here rather than through the chat means a real outage surfaces as a
failure instead of hiding inside a plausible refusal.
"""

from __future__ import annotations

import pytest

from railio.tools.search_corpus import search_corpus
from railio.tools.show_figure import show_figure

pytestmark = pytest.mark.db

# Subjects the seeded corpus genuinely covers.
QUERIES = [
    "ground relay trip procedure",
    "lube oil pressure at idle",
    "load regulator test",
    "dynamic brake grid blower",
    "traction motor",
]


@pytest.mark.parametrize("query", QUERIES)
async def test_retrieval_finds_something(query, org_id, figure_asset):
    res = await search_corpus(
        query, 6, "any", org_id=org_id, unit_model=figure_asset["unit_model"], asset_id=figure_asset["id"]
    )
    assert res["chunks"], (
        f"no chunks for {query!r} — the corpus is unseeded, or the search errored "
        f"and was swallowed into an empty result"
    )


async def test_k_is_honored_and_clamped(org_id, figure_asset):
    res = await search_corpus("traction motor", 3, "any", org_id=org_id)
    assert len(res["chunks"]) <= 3

    # k is clamped to 20 — a model asking for 500 must not dump the corpus into
    # the context window.
    res = await search_corpus("traction motor", 500, "any", org_id=org_id)
    assert len(res["chunks"]) <= 20


async def test_doc_class_filter_is_honored(org_id, figure_asset):
    res = await search_corpus("inspection", 6, "manual", org_id=org_id)
    assert all(c["doc_class"] == "manual" for c in res["chunks"]), res["chunks"]

    res = await search_corpus("inspection", 6, "tribal_knowledge", org_id=org_id)
    assert all(c["doc_class"] == "tribal_knowledge" for c in res["chunks"]), res["chunks"]


async def test_results_are_ours_or_shared(org_id, figure_asset, chunk_owners):
    res = await search_corpus(
        "ground relay", 20, "any", org_id=org_id, unit_model=figure_asset["unit_model"]
    )
    owners = await chunk_owners(c["id"] for c in res["chunks"])
    leaked = {cid: o for cid, o in owners.items() if o is not None and o != org_id}
    assert not leaked, f"retrieval crossed the tenant boundary: {leaked}"


async def test_chunks_carry_figure_metadata(org_id, figure_asset):
    """The model only knows a figure exists because search_corpus says so — if
    this metadata disappears, show_figure silently becomes unreachable."""
    res = await search_corpus(
        "wiring diagram", 20, "manual", org_id=org_id, unit_model=figure_asset["unit_model"]
    )
    with_figures = [c for c in res["chunks"] if c.get("figures")]
    assert with_figures, "no returned chunk carried figures metadata"
    fig = with_figures[0]["figures"][0]
    assert "index" in fig and isinstance(fig["index"], int)
    assert "figure_label" in fig and "caption" in fig


async def test_show_figure_loads_a_real_figure(org_id, figure_asset):
    res = await search_corpus(
        "wiring diagram", 20, "manual", org_id=org_id, unit_model=figure_asset["unit_model"]
    )
    chunk = next(c for c in res["chunks"] if c.get("figures"))
    out = await show_figure(chunk["id"], chunk["figures"][0]["index"], org_id=org_id)
    assert out["ok"] is True, out
    assert out["figure"]["path"]


async def test_show_figure_refuses_another_orgs_chunk(org_id, other_org_id):
    """The model picks chunk_id, so this tool is its own tenant boundary."""
    from sqlalchemy import text

    from railio.db import session_scope

    async with session_scope() as s:
        foreign = (
            await s.execute(
                text("SELECT id FROM corpus_chunks WHERE org_id = :o LIMIT 1"),
                {"o": other_org_id},
            )
        ).scalar_one_or_none()
    if foreign is None:
        pytest.skip("source org has no private chunks")

    out = await show_figure(int(foreign), 0, org_id=org_id)
    assert out.get("ok") is not True, "rendered another org's figure"


async def test_bad_figure_index_fails_cleanly(org_id, figure_asset):
    res = await search_corpus(
        "wiring diagram", 20, "manual", org_id=org_id, unit_model=figure_asset["unit_model"]
    )
    chunk = next(c for c in res["chunks"] if c.get("figures"))
    out = await show_figure(chunk["id"], 9999, org_id=org_id)
    assert out.get("ok") is not True
    assert out.get("error")
