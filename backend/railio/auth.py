"""Supabase JWT verification + first-login org resolution.

Verifies the access token Supabase issues after Google/Microsoft sign-in, and
maps a verified email to the org a new user should be provisioned into. The org
is then persisted in app_users (see organizations_repo.get_or_provision_user)
and that row — not this mapping — is the source of truth on later requests.
"""

from __future__ import annotations

from functools import lru_cache

import jwt
from jwt import PyJWKClient

from .config import get_settings


@lru_cache(maxsize=1)
def _jwks_client() -> PyJWKClient:
    url = get_settings().supabase_jwks_url
    if not url:
        raise RuntimeError("SUPABASE_JWKS_URL/SUPABASE_URL missing")
    return PyJWKClient(url)


def verify_supabase_jwt(token: str) -> dict:
    """Verify a Supabase access token and return its claims.

    Raises jwt.PyJWTError on any invalid/expired/tampered token.
    """
    settings = get_settings()
    options = {"require": ["exp", "sub"]}
    if settings.supabase_jwt_secret and not settings.supabase_url:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
            options=options,
        )
    signing_key = _jwks_client().get_signing_key_from_jwt(token).key
    return jwt.decode(
        token,
        signing_key,
        algorithms=["RS256", "ES256"],
        audience="authenticated",
        options=options,
    )


def resolve_org_slug(email: str) -> str:
    """Map a verified email to the org slug a first-time user belongs to.

    Allowlist (exact email) wins, then email domain, then the fallback sandbox.
    """
    settings = get_settings()
    email = email.lower().strip()
    allow = settings.email_allowlist
    if email in allow:
        return allow[email]
    domain = email.rsplit("@", 1)[-1] if "@" in email else ""
    domain_map = settings.domain_map
    if domain in domain_map:
        return domain_map[domain]
    return settings.auth_fallback_org
