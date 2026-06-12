from __future__ import annotations

import os
from functools import lru_cache
from typing import Optional

from dotenv import load_dotenv

load_dotenv()


class Settings:
    """Environment-driven settings."""

    openai_api_key: Optional[str]
    openai_chat_model: str
    openai_embeddings_model: str
    embeddings_provider: str
    voyage_api_key: Optional[str]
    cohere_api_key: Optional[str]
    port: int
    frontend_origin: str
    database_url: Optional[str]
    database_url_direct: Optional[str]
    supabase_url: Optional[str]
    supabase_service_role_key: Optional[str]
    supabase_jwks_url: Optional[str]
    supabase_jwt_secret: Optional[str]

    def __init__(self) -> None:
        self.openai_api_key = os.environ.get("OPENAI_API_KEY")
        self.openai_chat_model = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o")
        self.openai_embeddings_model = os.environ.get(
            "OPENAI_EMBEDDINGS_MODEL", "text-embedding-3-large"
        )
        self.embeddings_provider = os.environ.get("EMBEDDINGS_PROVIDER", "openai").lower()
        self.voyage_api_key = os.environ.get("VOYAGE_API_KEY")
        self.cohere_api_key = os.environ.get("COHERE_API_KEY")
        self.port = int(os.environ.get("PORT", "3001"))
        # Default covers local dev + the production frontend + Vercel preview
        # deploys, so CORS works in prod even if FRONTEND_ORIGIN isn't set there.
        # Override via env to add/replace origins.
        self.frontend_origin = os.environ.get(
            "FRONTEND_ORIGIN",
            "http://localhost:3000,https://railio.xyz,https://www.railio.xyz,*.vercel.app",
        )
        self.database_url = os.environ.get("DATABASE_URL")
        self.database_url_direct = os.environ.get("DATABASE_URL_DIRECT")
        self.supabase_url = os.environ.get("SUPABASE_URL")
        self.supabase_service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        # JWKS for verifying Supabase access tokens. Defaults to the project's
        # well-known endpoint derived from SUPABASE_URL — no extra env needed.
        self.supabase_jwks_url = os.environ.get("SUPABASE_JWKS_URL") or (
            f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
            if self.supabase_url
            else None
        )
        # HS256 fallback for projects still on a symmetric JWT secret. When set
        # (and no JWKS), tokens are verified with this instead of the JWKS keys.
        self.supabase_jwt_secret = os.environ.get("SUPABASE_JWT_SECRET")

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.frontend_origin.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
