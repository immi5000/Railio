"""ChatRun — the event list a run_chat call produced, plus what must be true of it.

run_chat takes a synchronous emit callback, so `list.append` is the emit and a
ChatRun is just that list with accessors. assert_stream_contract holds every
invariant that is true regardless of what the model chose to say, which is what
lets ~28 live runs each verify far more than the one tool they were written for.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from railio.contract import Message, ToolCall
from railio.tools import TOOL_DEFS

MODEL_TOOLS = {t["function"]["name"] for t in TOOL_DEFS}
# set_ticket_status is fired by the runtime, not chosen by the model, and
# suggest_replies is synthesized after the loop — neither is in TOOL_DEFS, but
# both legitimately appear as tool_calls.
RUNTIME_TOOLS = {"set_ticket_status", "suggest_replies"}
KNOWN_TOOLS = MODEL_TOOLS | RUNTIME_TOOLS

# Emitted to the live stream but never written to messages.tool_calls, so the
# chip shows during the turn and is gone on reload. Documenting rather than
# asserting it away: whether that's worth fixing is a product call.
STREAM_ONLY_TOOLS = {"set_ticket_status"}

CITE_RE = re.compile(r"\[([^\]]*)\]\(cite:(\d+)\)")


@dataclass
class ChatRun:
    prompt: str
    ticket_id: int
    role: str
    events: list[dict[str, Any]] = field(default_factory=list)

    # --- accessors -------------------------------------------------------

    def of_type(self, t: str) -> list[dict]:
        return [e for e in self.events if e.get("type") == t]

    def types(self) -> list[str]:
        return [e.get("type") for e in self.events]

    def starts(self, name: str | None = None) -> list[dict]:
        return [
            e
            for e in self.of_type("tool_call_started")
            if name is None or e.get("name") == name
        ]

    def completions(self, name: str | None = None) -> list[dict]:
        by_id = {e["call_id"]: e.get("name") for e in self.of_type("tool_call_started")}
        return [
            e
            for e in self.of_type("tool_call_completed")
            if name is None or by_id.get(e.get("call_id")) == name
        ]

    def called(self, name: str) -> bool:
        return bool(self.starts(name))

    def tools_called(self) -> list[str]:
        return [e["name"] for e in self.starts()]

    def inputs(self, name: str) -> list[dict]:
        return [e.get("input") or {} for e in self.starts(name)]

    def outputs(self, name: str) -> list[dict]:
        return [e.get("output") or {} for e in self.completions(name)]

    def first_index(self, tool: str) -> int | None:
        for i, e in enumerate(self.events):
            if e.get("type") == "tool_call_started" and e.get("name") == tool:
                return i
        return None

    def assistant_text(self) -> str:
        return "".join(e.get("delta", "") for e in self.of_type("assistant_token"))

    def persisted_assistant(self) -> dict | None:
        evs = self.of_type("assistant_message_persisted")
        return evs[-1]["message"] if evs else None

    def searched_chunk_ids(self) -> set[int]:
        """Every chunk id search_corpus handed back this run."""
        ids: set[int] = set()
        for out in self.outputs("search_corpus"):
            for c in out.get("chunks") or []:
                if isinstance(c.get("id"), int):
                    ids.add(c["id"])
        return ids

    def searched_chunks(self) -> dict[int, dict]:
        chunks: dict[int, dict] = {}
        for out in self.outputs("search_corpus"):
            for c in out.get("chunks") or []:
                if isinstance(c.get("id"), int):
                    chunks[c["id"]] = c
        return chunks

    def report(self) -> str:
        return (
            f"  ticket {self.ticket_id} (role={self.role})\n"
            f"    tools fired : {self.tools_called() or '(none)'}\n"
            f"    event counts: {dict(Counter(self.types()))}\n"
            f"    assistant   : {self.assistant_text()[:300]!r}"
        )


# --- the contract ---------------------------------------------------------


def assert_stream_contract(run: ChatRun) -> None:
    """Everything that must hold for any run, whatever the model decided."""
    evs = run.events
    types = run.types()
    assert evs, "run emitted no events at all"

    # Shape.
    assert types[0] == "user_message_persisted", f"first event was {types[0]!r}"
    assert types.count("user_message_persisted") == 1
    assert types[-1] == "done", f"last event was {types[-1]!r}, expected 'done'"
    assert types.count("done") == 1
    assert types.count("assistant_message_persisted") == 1
    assert types[-2] == "assistant_message_persisted", (
        f"expected assistant_message_persisted immediately before done, got {types[-2]!r}"
    )

    _assert_tool_pairing(run)
    _assert_side_events_nest(run)
    _assert_stream_matches_persisted(run)
    _assert_contract_types(run)
    _assert_citations(run)


def _assert_tool_pairing(run: ChatRun) -> None:
    started: list[str] = []
    for e in run.events:
        if e.get("type") == "tool_call_started":
            assert e["name"] in KNOWN_TOOLS, (
                f"unknown tool {e['name']!r} — renamed in TOOL_DEFS but not everywhere?"
            )
            assert e["call_id"] not in started, f"duplicate call_id {e['call_id']!r}"
            started.append(e["call_id"])
        elif e.get("type") == "tool_call_completed":
            assert e["call_id"] in started, (
                f"tool_call_completed {e['call_id']!r} with no earlier started"
            )
    completed = [e["call_id"] for e in run.of_type("tool_call_completed")]
    assert sorted(started) == sorted(completed), (
        f"started {started} but completed {completed}"
    )


def _assert_side_events_nest(run: ChatRun) -> None:
    """request_photo / show_figure are emitted from inside their tool's execution."""
    spans: dict[str, tuple[int, int]] = {}
    open_at: dict[str, int] = {}
    for i, e in enumerate(run.events):
        if e.get("type") == "tool_call_started":
            open_at[e["call_id"]] = i
        elif e.get("type") == "tool_call_completed":
            spans[e["call_id"]] = (open_at[e["call_id"]], i)

    tool_spans = {
        name: [
            spans[e["call_id"]]
            for e in run.starts(name)
            if e["call_id"] in spans
        ]
        for name in ("request_photo", "show_figure")
    }
    for i, e in enumerate(run.events):
        t = e.get("type")
        if t not in ("request_photo", "show_figure"):
            continue
        assert any(lo < i < hi for lo, hi in tool_spans[t]), (
            f"{t} event at index {i} is not inside any {t} tool call"
        )


def _assert_stream_matches_persisted(run: ChatRun) -> None:
    """The streamed text is exactly what got written to the DB.

    Fully deterministic and free — a real invariant of chat_loop, and the thing
    that would break if the streaming and persistence paths ever diverged.
    """
    msg = run.persisted_assistant()
    assert msg is not None
    assert run.assistant_text().strip() == msg["content"], (
        "streamed tokens != persisted content\n"
        f"  streamed : {run.assistant_text().strip()[:200]!r}\n"
        f"  persisted: {msg['content'][:200]!r}"
    )

    # The persisted tool_calls are the ones we watched happen — except
    # set_ticket_status, which chat_loop emits to the stream before all_tool_calls
    # even exists, so it is live-only and vanishes on reload. Asserting the
    # streamed set here would be asserting a fiction; STREAM_ONLY_TOOLS records
    # the real boundary.
    persisted = [tc["name"] for tc in (msg.get("tool_calls") or [])]
    observed = [n for n in run.tools_called() if n not in STREAM_ONLY_TOOLS]
    if run.role == "tech" and run.of_type("suggest_replies"):
        observed = observed + ["suggest_replies"]
    assert sorted(persisted) == sorted(observed), (
        f"persisted tool_calls {persisted} != observed {observed}"
    )


def _assert_contract_types(run: ChatRun) -> None:
    for e in run.of_type("user_message_persisted") + run.of_type("assistant_message_persisted"):
        Message.model_validate(e["message"])
    msg = run.persisted_assistant()
    for tc in msg.get("tool_calls") or []:
        ToolCall.model_validate(tc)


def _assert_citations(run: ChatRun) -> None:
    """No invented citations.

    A cite pointing at a chunk the run never retrieved is a hallucinated source —
    the one citation failure that is never acceptable and never a matter of
    phrasing, so it belongs here.

    The label's *wording* is deliberately not checked. The model drifts on it
    (usually toward a figure name, or a page range a single-chunk link can't
    deliver), so ChatPane renders the source_label recorded on the citation
    rather than the text the model typed — the property holds by construction,
    and frontend/tests/ChatPane.test.tsx pins it deterministically. Asserting the
    model's prose here would only add flake.
    """
    msg = run.persisted_assistant()
    available = set(run.searched_chunks())

    cited = [c["chunk_id"] for c in (msg.get("citations") or [])]
    assert len(cited) == len(set(cited)), f"duplicate citation chunk_ids: {cited}"
    for cid in cited:
        assert cid in available, (
            f"citation chunk_id {cid} was never returned by search_corpus this run "
            f"(returned: {sorted(available)})"
        )

    for _label, raw_id in CITE_RE.findall(run.assistant_text()):
        cid = int(raw_id)
        assert cid in available, (
            f"inline cite:{cid} was never returned by search_corpus this run — the "
            f"model invented a source (returned: {sorted(available)})"
        )




def assert_no_cross_tenant_chunks(run: ChatRun, org_id: int, chunk_orgs: dict[int, int | None]) -> None:
    """Every chunk the run touched belongs to this org or is shared (org_id NULL)."""
    for cid, owner in chunk_orgs.items():
        assert owner is None or owner == org_id, (
            f"chunk {cid} belongs to org {owner}, not {org_id} or shared — tenant leak"
        )


def dump_events(run: ChatRun) -> str:
    return json.dumps(run.events, indent=2, default=str)
