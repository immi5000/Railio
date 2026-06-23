"""Retry wrapper for OpenAI calls.

This org's gpt-4o TPM limit is low (30k), so a long manual reliably trips a 429
mid-run. Without backoff a single 429 aborts the whole extraction (losing all
prior vision work). Wrap each API call so a rate-limit/transient error waits and
retries instead of crashing.
"""

from __future__ import annotations

import time
from typing import Callable, TypeVar

from openai import APIConnectionError, APIError, RateLimitError

T = TypeVar("T")

_MAX_ATTEMPTS = 8


def with_retries(fn: Callable[[], T], *, what: str = "openai call") -> T:
    """Call fn(), retrying on rate-limit / transient API errors with exponential
    backoff (capped). Re-raises the last error after _MAX_ATTEMPTS."""
    delay = 5.0
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            return fn()
        except RateLimitError as e:
            if attempt == _MAX_ATTEMPTS:
                raise
            wait = _retry_after(e) or delay
            print(
                f"  ⏳ rate-limited on {what} (attempt {attempt}/{_MAX_ATTEMPTS}); "
                f"waiting {wait:.0f}s"
            )
            time.sleep(wait)
            delay = min(delay * 2, 60.0)
        except (APIConnectionError, APIError) as e:
            # Transient 5xx / network blips — back off and retry; 4xx (other than
            # 429) re-raise immediately since retrying won't help.
            status = getattr(e, "status_code", None)
            if attempt == _MAX_ATTEMPTS or (status is not None and 400 <= status < 500):
                raise
            print(
                f"  ⏳ transient error on {what} (attempt {attempt}/{_MAX_ATTEMPTS}): "
                f"{e}; waiting {delay:.0f}s"
            )
            time.sleep(delay)
            delay = min(delay * 2, 60.0)
    raise RuntimeError("unreachable")  # pragma: no cover


def _retry_after(e: RateLimitError) -> float | None:
    """Honor the server's suggested wait if present (header or message)."""
    resp = getattr(e, "response", None)
    if resp is not None:
        hdr = resp.headers.get("retry-after") if hasattr(resp, "headers") else None
        if hdr:
            try:
                return float(hdr)
            except ValueError:
                pass
    return None
