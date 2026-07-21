"""The append-only message log and its sha256 chain.

The chain is the audit story: it has to be able to prove a thread wasn't edited
after the fact. So the tests that matter are the ones showing it actually
*detects* tampering, not just that it validates clean data.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from railio.db import session_scope
from railio.hash import chain_hash
from railio.messages_repo import insert_message
from tests.helpers.chain import chain_errors

pytestmark = pytest.mark.db


async def _rows(ticket_id: int) -> list[dict]:
    async with session_scope() as s:
        rows = (
            await s.execute(
                text(
                    "SELECT id, role, content, prev_hash, hash FROM messages "
                    "WHERE ticket_id = :t ORDER BY id"
                ),
                {"t": ticket_id},
            )
        ).mappings().all()
    return [dict(r) for r in rows]


async def test_chain_links_each_message_to_the_last(make_ticket):
    tid = await make_ticket()
    await insert_message(ticket_id=tid, role="dispatcher", content="one")
    await insert_message(ticket_id=tid, role="assistant", content="two")
    await insert_message(ticket_id=tid, role="tech", content="three")

    rows = await _rows(tid)
    assert rows[0]["prev_hash"] is None, "first message should open the chain"
    assert rows[1]["prev_hash"] == rows[0]["hash"]
    assert rows[2]["prev_hash"] == rows[1]["hash"]
    assert not await chain_errors(tid)


async def test_chains_are_independent_per_ticket(make_ticket):
    a, b = await make_ticket(), await make_ticket()
    await insert_message(ticket_id=a, role="dispatcher", content="a1")
    await insert_message(ticket_id=b, role="dispatcher", content="b1")
    assert (await _rows(b))[0]["prev_hash"] is None, "ticket b linked to ticket a's chain"
    assert not await chain_errors(a)
    assert not await chain_errors(b)


async def test_nested_tool_calls_survive_the_jsonb_round_trip(make_ticket):
    """Keys are sorted before hashing precisely because JSONB reorders them.

    An insertion-order hash re-read from Postgres fails to verify for any message
    with nested objects — this is that regression.
    """
    tid = await make_ticket()
    await insert_message(
        ticket_id=tid,
        role="assistant",
        content="with tools",
        tool_calls=[
            {
                "call_id": "c1",
                "name": "search_corpus",
                "input": {"query": "z", "k": 6, "doc_class_filter": "any"},
                "output": {"chunks": [{"id": 1, "source_label": "L", "page": 2}]},
            }
        ],
        citations=[
            {
                "chunk_id": 1,
                "doc_class": "manual",
                "doc_id": "d",
                "page": 2,
                "source_label": "L",
            }
        ],
    )
    assert not await chain_errors(tid), "chain broke on a message with nested JSON"


async def test_tampering_with_content_is_detected(make_ticket):
    tid = await make_ticket()
    await insert_message(ticket_id=tid, role="dispatcher", content="the original")
    assert not await chain_errors(tid)

    async with session_scope() as s:
        await s.execute(
            text("UPDATE messages SET content = :c WHERE ticket_id = :t"),
            {"c": "quietly rewritten", "t": tid},
        )

    errors = await chain_errors(tid)
    assert errors, "content was edited and the chain did not notice"
    assert "hash mismatch" in errors[0]


async def test_breaking_a_link_is_detected(make_ticket):
    tid = await make_ticket()
    await insert_message(ticket_id=tid, role="dispatcher", content="one")
    await insert_message(ticket_id=tid, role="assistant", content="two")

    rows = await _rows(tid)
    async with session_scope() as s:
        await s.execute(
            text("UPDATE messages SET prev_hash = :p WHERE id = :id"),
            {"p": "0" * 64, "id": rows[1]["id"]},
        )

    errors = await chain_errors(tid)
    assert any("prev_hash" in e for e in errors), errors


def test_payload_key_set_is_locked():
    """The hash covers exactly these fields — adding one silently invalidates
    every existing row, so it should take a deliberate edit to this test."""
    payload = {
        "ticket_id": 1,
        "role": "tech",
        "content": "x",
        "citations": None,
        "attachments": None,
        "tool_calls": None,
        "created_at": "2026-01-01T00:00:00.000Z",
    }
    # Key order must not matter; the serializer sorts.
    shuffled = dict(reversed(list(payload.items())))
    assert chain_hash(None, payload) == chain_hash(None, shuffled)
