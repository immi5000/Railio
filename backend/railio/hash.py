"""sha256 chain-hash for the append-only messages table."""

from __future__ import annotations

import hashlib
import json
from typing import Any


def chain_hash(prev: str | None, payload: dict[str, Any]) -> str:
    """sha256(prev_hash || \\x00 || canonical-JSON(payload)).

    Keys are sorted recursively so the hash is stable across a Postgres JSONB
    round-trip: JSONB does not preserve object key insertion order, so an
    insertion-order serialization would not re-verify after read-back (any
    message with nested tool_calls / citations objects would fail). The backend
    is the sole hash writer, so sorting here is fully self-consistent.
    """
    h = hashlib.sha256()
    h.update((prev or "").encode("utf-8"))
    h.update(b"\x00")
    h.update(
        json.dumps(
            payload, separators=(",", ":"), ensure_ascii=False, sort_keys=True
        ).encode("utf-8")
    )
    return h.hexdigest()
