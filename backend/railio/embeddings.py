"""Multi-provider embeddings (OpenAI / Voyage / Cohere). 1024-dim output."""

from __future__ import annotations

from typing import Literal

import httpx

from .config import get_settings
from .openai_client import get_openai

InputType = Literal["document", "query"]


async def embed(texts: list[str], input_type: InputType = "document") -> list[list[float]]:
    if not texts:
        return []
    provider = get_settings().embeddings_provider
    if provider == "openai":
        return await _embed_openai(texts)
    if provider == "voyage":
        return await _embed_voyage(texts, input_type)
    if provider == "cohere":
        return await _embed_cohere(texts, input_type)
    raise RuntimeError(f"Unknown EMBEDDINGS_PROVIDER: {provider}")


async def _embed_openai(texts: list[str]) -> list[list[float]]:
    client = get_openai()
    model = get_settings().openai_embeddings_model
    # text-embedding-3-* supports `dimensions` via Matryoshka.
    r = await client.embeddings.create(model=model, input=texts, dimensions=1024)
    return [list(d.embedding) for d in r.data]


async def _embed_voyage(texts: list[str], input_type: InputType) -> list[list[float]]:
    key = get_settings().voyage_api_key
    if not key:
        raise RuntimeError("VOYAGE_API_KEY missing")
    model = get_settings().openai_embeddings_model or "voyage-3-large"
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(
            "https://api.voyageai.com/v1/embeddings",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
            json={
                "model": model,
                "input": texts,
                "input_type": input_type,
                "output_dimension": 1024,
            },
        )
        r.raise_for_status()
        data = r.json()["data"]
        return [list(d["embedding"]) for d in data]


async def _embed_cohere(texts: list[str], input_type: InputType) -> list[list[float]]:
    key = get_settings().cohere_api_key
    if not key:
        raise RuntimeError("COHERE_API_KEY missing")
    model = get_settings().openai_embeddings_model or "embed-v3"
    cohere_input_type = "search_document" if input_type == "document" else "search_query"
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(
            "https://api.cohere.com/v2/embed",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
            json={
                "model": model,
                "texts": texts,
                "input_type": cohere_input_type,
                "embedding_types": ["float"],
            },
        )
        r.raise_for_status()
        return r.json()["embeddings"]["float"]
