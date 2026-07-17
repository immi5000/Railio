"""Hash-chain verification, scoped to one ticket.

Same payload shape and ordering as scripts/verify_chain — if the two ever
disagree, one of them is wrong about what the backend actually hashes.
"""

from __future__ import annotations

from sqlalchemy import text

from railio.db import session_scope
from railio.hash import chain_hash

_SELECT = text(
    """
    SELECT id, ticket_id, role, content, citations, attachments,
           tool_calls, created_at, prev_hash, hash
    FROM messages WHERE ticket_id = :tid ORDER BY id ASC
    """
)


async def chain_errors(ticket_id: int) -> list[str]:
    """Every chain violation on this ticket; empty means intact."""
    async with session_scope() as s:
        rows = (await s.execute(_SELECT, {"tid": ticket_id})).mappings().all()

    errors: list[str] = []
    prev: str | None = None
    for r in rows:
        if r["prev_hash"] != prev:
            errors.append(
                f"msg {r['id']}: prev_hash {r['prev_hash']!r} != preceding hash {prev!r}"
            )
        expected = chain_hash(
            prev,
            {
                "ticket_id": r["ticket_id"],
                "role": r["role"],
                "content": r["content"],
                "citations": r["citations"],
                "attachments": r["attachments"],
                "tool_calls": r["tool_calls"],
                "created_at": r["created_at"],
            },
        )
        if expected != r["hash"]:
            errors.append(f"msg {r['id']} ({r['role']}): hash mismatch — row has been altered")
        prev = r["hash"]
    return errors


async def assert_chain_intact(ticket_id: int) -> None:
    errors = await chain_errors(ticket_id)
    assert not errors, f"hash chain broken on ticket {ticket_id}:\n  " + "\n  ".join(errors)
