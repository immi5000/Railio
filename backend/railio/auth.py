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


# Free / public email providers. A user on one of these gets a personal org
# named after their username instead of a shared per-domain org.
PUBLIC_EMAIL_DOMAINS = {
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "msn.com",
    "yahoo.com",
    "ymail.com",
    "icloud.com",
    "me.com",
    "mac.com",
    "proton.me",
    "protonmail.com",
    "aol.com",
    "gmx.com",
    "zoho.com",
}


def _slugify(raw: str) -> str:
    """Lowercase, keep [a-z0-9-], collapse the rest to single dashes."""
    out: list[str] = []
    prev_dash = False
    for ch in raw.lower().strip():
        if ch.isalnum():
            out.append(ch)
            prev_dash = False
        elif not prev_dash:
            out.append("-")
            prev_dash = True
    return "".join(out).strip("-") or "org"


def split_email(email: str) -> tuple[str, str]:
    """Return (local_part, domain) lowercased."""
    email = email.lower().strip()
    local, _, domain = email.partition("@")
    return local, domain


def is_public_domain(domain: str) -> bool:
    return domain in PUBLIC_EMAIL_DOMAINS


def auto_org_for_email(email: str) -> tuple[str, str]:
    """The (slug, display_name) to auto-create for an email with no domain rule.

    Public email → personal org from the username. Company domain → org from the
    domain's first label (newco.com → "newco" / "Newco").
    """
    local, domain = split_email(email)
    if is_public_domain(domain):
        slug = _slugify(local)
        return slug, local
    label = domain.split(".")[0] if domain else ""
    slug = _slugify(label)
    return slug, label.capitalize() if label else slug
