"""search_corpus fires for a question the corpus can answer, however it's asked.

Rule 1 makes this the load-bearing tool: every substantive answer has to cite a
chunk, so a miss here means the model answered from general knowledge instead.

Each phrasing is one live run carrying every assertion we can make about it —
tool fired, args sane, tenant boundary held, answer cited. Re-running a prompt to
check one more thing would just be paying twice for the same call.
"""

from __future__ import annotations

import pytest

from tests.helpers.chat import expect_tool

pytestmark = [pytest.mark.live_openai, pytest.mark.db]

# Four ways of asking a manual question, same intent, different shapes: a
# procedure, a test, a spec lookup, an explanation.
PROMPTS = [
    "What's the ground relay trip procedure?",
    "How do I test the load regulator?",
    "What's the lube oil pressure spec at idle?",
    "Explain how the dynamic brake grid blower works.",
]


@pytest.mark.parametrize("prompt", PROMPTS)
async def test_search_corpus_fires(prompt, make_ticket, org_id, chunk_owners):
    run = await expect_tool(
        tool="search_corpus",
        make_ticket=make_ticket,
        org_id=org_id,
        prompt=prompt,
        role="dispatcher",
    )

    for inp in run.inputs("search_corpus"):
        assert isinstance(inp.get("query"), str) and inp["query"].strip(), (
            f"empty search query: {inp!r}"
        )
        # k and doc_class_filter are the model's call — only their shape is ours.
        if "k" in inp:
            assert isinstance(inp["k"], (int, float)), f"non-numeric k: {inp['k']!r}"
        if "doc_class_filter" in inp:
            assert inp["doc_class_filter"] in ("manual", "tribal_knowledge", "any")

    for out in run.outputs("search_corpus"):
        assert isinstance(out.get("chunks"), list), f"no chunks list in {out!r}"

    chunk_ids = run.searched_chunk_ids()

    # Retrieval may only surface our chunks or shared reference data (CFR).
    owners = await chunk_owners(chunk_ids)
    leaked = {cid: o for cid, o in owners.items() if o is not None and o != org_id}
    assert not leaked, f"search_corpus returned another org's chunks: {leaked}"

    # Rule 1, conditional on there being anything to cite. Whether a given model-
    # chosen query hits is retrieval's business, not this test's — that's covered
    # deterministically in tests/test_corpus_retrieval.py. Asserting a hit here
    # would make a prompt-conformance test fail for a search-quality reason.
    if chunk_ids:
        assert run.persisted_assistant()["citations"], (
            "answer carried no citations despite a corpus hit (rule 1)\n" + run.report()
        )
