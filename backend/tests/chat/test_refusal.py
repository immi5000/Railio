"""Rule 2: when the corpus is silent, refuse verbatim rather than guess.

This is the rule that separates Railio from a general chatbot, so it's worth the
live calls.

The prompts are deliberately far outside rail AND share no component vocabulary
with a locomotive manual. That second part is not fussiness — it's working around
a known weakness. `search_corpus` has no relevance floor: it returns the k
nearest chunks however far they are. "How do I rebuild a Cummins ISX
turbocharger?" comes back with EMD GP38-2 maintenance records at distance ~1.07
(i.e. nothing relevant), and the model then sometimes answers a Cummins question
out of EMD content rather than refusing.

That contamination is a real product issue — a distance threshold in
search_corpus would make rule 2 hold by construction instead of by luck — but it
is a retrieval-tuning decision, not something this test should encode. Using
vocabulary-overlapping prompts here would just make the suite flaky while
pointing at the wrong culprit.
"""

from __future__ import annotations

import pytest

from tests.helpers.chat import run_prompt

pytestmark = [pytest.mark.live_openai, pytest.mark.db]

REFUSAL = "I don't have this in your manuals or tribal notes."

PROMPTS = [
    "What's the torque spec for a Boeing 737 landing gear?",
    "What's the correct water-to-cement ratio for a concrete foundation pour?",
    "What's the recommended tire pressure on a Caterpillar 797 haul truck?",
    "How do I service the battery pack on a Tesla Model 3?",
]


@pytest.mark.parametrize("prompt", PROMPTS)
async def test_refuses_outside_the_corpus(prompt, make_ticket, org_id):
    run = await run_prompt(
        make_ticket=make_ticket,
        org_id=org_id,
        prompt=prompt,
        role="dispatcher",
    )
    assert REFUSAL in run.assistant_text(), (
        "expected the verbatim refusal (rule 2), got an answer instead.\n"
        f"  refusal expected: {REFUSAL!r}\n" + run.report()
    )
    assert not run.persisted_assistant()["citations"], (
        "refused but still attached citations — a refusal cites nothing by "
        "definition, so this means it half-answered"
    )
