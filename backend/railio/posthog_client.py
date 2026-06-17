"""PostHog analytics client — singleton initialized at app startup."""

from __future__ import annotations

import atexit

from posthog import Posthog

from .config import get_settings

_client: Posthog | None = None


def init_posthog() -> None:
    global _client
    settings = get_settings()
    if not settings.posthog_project_token:
        return
    _client = Posthog(
        project_api_key=settings.posthog_project_token,
        host=settings.posthog_host,
        enable_exception_autocapture=True,
    )
    atexit.register(_client.shutdown)


def get_posthog() -> Posthog | None:
    return _client


def shutdown_posthog() -> None:
    if _client:
        _client.flush()
