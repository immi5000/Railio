"""sha256 chain-hash for the append-only messages table."""

from __future__ import annotations

import hashlib
import json
from typing import Any


def chain_hash(prev: str | None, payload: dict[str, Any]) -> str:
    """sha256(prev_hash || \\x00 || JSON.stringify(payload)).

    The TS counterpart uses JSON.stringify with default key order (insertion).
    We match it by serializing without sorting and with no extra whitespace.
    """
    h = hashlib.sha256()
    h.update((prev or "").encode("utf-8"))
    h.update(b"\x00")
    h.update(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    return h.hexdigest()
