"""The chat rate limiter.

Called directly rather than through the route: the ASGI client overrides the
dependency (every other test would be throttled otherwise), and the interesting
behavior is the sliding window itself, not the 429 wrapper around it.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from railio.db import session_scope
from railio.rate_limit_repo import check_and_record

pytestmark = pytest.mark.db


@pytest.fixture
async def uid():
    """A fresh identity per test — the window is keyed on it, so sharing one
    would make these order-dependent."""
    u = f"ratelimit-test-{uuid.uuid4().hex[:12]}"
    yield u
    async with session_scope() as s:
        await s.execute(
            text("DELETE FROM chat_rate_events WHERE supabase_user_id = :u"), {"u": u}
        )


async def _event_count(uid: str) -> int:
    async with session_scope() as s:
        return (
            await s.execute(
                text("SELECT count(*) FROM chat_rate_events WHERE supabase_user_id = :u"),
                {"u": uid},
            )
        ).scalar_one()


async def test_allows_up_to_the_limit_then_denies(uid):
    assert await check_and_record(uid, 2, 60) is None
    assert await check_and_record(uid, 2, 60) is None

    retry = await check_and_record(uid, 2, 60)
    assert isinstance(retry, int), f"expected Retry-After seconds, got {retry!r}"
    assert retry >= 1


async def test_a_denied_call_does_not_consume_the_window(uid):
    await check_and_record(uid, 1, 60)
    await check_and_record(uid, 1, 60)  # denied
    await check_and_record(uid, 1, 60)  # denied
    assert await _event_count(uid) == 1, "denied calls were recorded as if allowed"


async def test_limit_zero_disables_and_records_nothing(uid):
    for _ in range(5):
        assert await check_and_record(uid, 0, 60) is None
    assert await _event_count(uid) == 0


async def test_users_have_independent_windows(uid):
    other = f"{uid}-other"
    try:
        assert await check_and_record(uid, 1, 60) is None
        assert await check_and_record(uid, 1, 60) is not None  # uid exhausted
        assert await check_and_record(other, 1, 60) is None, "one user's traffic throttled another"
    finally:
        async with session_scope() as s:
            await s.execute(
                text("DELETE FROM chat_rate_events WHERE supabase_user_id = :u"),
                {"u": other},
            )
