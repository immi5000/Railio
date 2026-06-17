"""Per-user chat rate limiting (sliding window, Postgres-backed).

One row per accepted message keyed on the JWT `sub`. A check counts rows in the
trailing window; over the limit returns the seconds to wait, under it records a
new row. Older rows are pruned on each check so the table stays small.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from .db import session_scope


def _iso(dt: datetime) -> str:
    # Match messages_repo: ISO-8601 UTC, ms precision, Z suffix (lexicographically
    # sortable, so string comparison on created_at is a valid time comparison).
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(dt.microsecond / 1000):03d}Z"


async def check_and_record(
    supabase_user_id: str, limit: int, window_seconds: int
) -> int | None:
    """Allow → record a row and return None. Deny → return Retry-After seconds.

    limit <= 0 disables the limiter (always allows, records nothing).
    """
    if limit <= 0:
        return None

    now = datetime.now(timezone.utc)
    cutoff = _iso(now - timedelta(seconds=window_seconds))

    async with session_scope() as session:
        # Drop rows that have aged out of every user's window. Cheap with the
        # (supabase_user_id, created_at) index; keeps the table bounded.
        await session.execute(
            text("DELETE FROM chat_rate_events WHERE created_at < :cutoff"),
            {"cutoff": cutoff},
        )

        rows = (
            await session.execute(
                text(
                    """
                    SELECT created_at FROM chat_rate_events
                    WHERE supabase_user_id = :uid AND created_at >= :cutoff
                    ORDER BY created_at ASC
                    """
                ),
                {"uid": supabase_user_id, "cutoff": cutoff},
            )
        ).scalars().all()

        if len(rows) >= limit:
            # Retry-After = time until the oldest in-window event ages out.
            oldest = datetime.strptime(rows[0], "%Y-%m-%dT%H:%M:%S.%fZ").replace(
                tzinfo=timezone.utc
            )
            elapsed = (now - oldest).total_seconds()
            return max(1, math.ceil(window_seconds - elapsed))

        await session.execute(
            text(
                "INSERT INTO chat_rate_events (supabase_user_id, created_at) "
                "VALUES (:uid, :created_at)"
            ),
            {"uid": supabase_user_id, "created_at": _iso(now)},
        )
        return None
