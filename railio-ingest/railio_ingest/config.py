"""Env-driven settings for the ingestion tool. Reads the same prod creds the
backend uses, plus OpenAI model overrides."""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Optional

from dotenv import load_dotenv

load_dotenv()


class Settings:
    def __init__(self) -> None:
        self.database_url: Optional[str] = os.environ.get("DATABASE_URL")
        self.supabase_url: Optional[str] = os.environ.get("SUPABASE_URL")
        self.supabase_service_role_key: Optional[str] = os.environ.get(
            "SUPABASE_SERVICE_ROLE_KEY"
        )
        self.openai_api_key: Optional[str] = os.environ.get("OPENAI_API_KEY")
        self.vision_model: str = os.environ.get("OPENAI_VISION_MODEL", "gpt-4o")
        self.embeddings_model: str = os.environ.get(
            "OPENAI_EMBEDDINGS_MODEL", "text-embedding-3-large"
        )

    def require_db(self) -> str:
        if not self.database_url:
            raise RuntimeError("DATABASE_URL missing — copy .env.example to .env")
        return self.database_url

    def require_openai(self) -> str:
        if not self.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY missing — copy .env.example to .env")
        return self.openai_api_key


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
