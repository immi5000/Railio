"""OpenAI embeddings — 1024-dim, matching prod (text-embedding-3-large + the
Matryoshka `dimensions` param). Same vectors prod produces, so retrieval is
consistent."""

from __future__ import annotations

from openai import OpenAI

from .config import get_settings
from .retry import with_retries

_BATCH = 96


def _client() -> OpenAI:
    return OpenAI(api_key=get_settings().require_openai())


def embed_documents(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    client = _client()
    model = get_settings().embeddings_model
    out: list[list[float]] = []
    for i in range(0, len(texts), _BATCH):
        batch = texts[i : i + _BATCH]
        r = with_retries(
            lambda b=batch: client.embeddings.create(
                model=model, input=b, dimensions=1024
            ),
            what="embeddings",
        )
        out.extend(list(d.embedding) for d in r.data)
    return out


def to_vector_literal(vec: list[float]) -> str:
    """pgvector text literal — asyncpg won't convert a Python list to vector."""
    return "[" + ",".join(str(x) for x in vec) + "]"
