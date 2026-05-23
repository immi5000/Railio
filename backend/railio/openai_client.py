"""Singleton OpenAI async client."""

from __future__ import annotations

from functools import lru_cache

from openai import AsyncOpenAI

from .config import get_settings


@lru_cache(maxsize=1)
def get_openai() -> AsyncOpenAI:
    key = get_settings().openai_api_key
    if not key:
        raise RuntimeError("OPENAI_API_KEY missing")
    return AsyncOpenAI(api_key=key)


def chat_model() -> str:
    return get_settings().openai_chat_model
