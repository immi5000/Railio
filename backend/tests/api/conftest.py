"""ASGI client with auth overridden to the unit_tests org.

Auth is overridden, not faked with a real token: get_current_user verifies a
Supabase JWT and get_current_org reads our DB, and neither is what these tests
are about. enforce_chat_rate_limit has to be overridden separately — it Depends
on get_current_user itself, so overriding that alone still leaves it hitting the
rate-limit table.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from railio.contract import Organization
from railio.main import create_app
from railio.organizations_repo import get_org_by_id
from railio.org_context import get_current_org, get_current_user
from railio.routers.messages import enforce_chat_rate_limit


@pytest.fixture(scope="session")
async def app(org_id):
    application = create_app()
    org = await get_org_by_id(org_id)
    assert org is not None

    def _user() -> dict:
        return {
            "id": 1,
            "supabase_user_id": "unit-tests-sub",
            "email": "tests@railio.test",
            "name": "Unit Tests",
            "phone": None,
            "profile_completed": True,
            "org_id": org_id,
        }

    application.dependency_overrides[get_current_user] = _user
    application.dependency_overrides[get_current_org] = lambda: org
    application.dependency_overrides[enforce_chat_rate_limit] = lambda: None
    return application


@pytest.fixture(scope="session")
async def other_org(other_org_id) -> Organization:
    org = await get_org_by_id(other_org_id)
    assert org is not None
    return org


@pytest.fixture(scope="session")
async def client(app):
    # ASGITransport does not run lifespan, which is what we want: it skips
    # init_posthog() and, more importantly, the app's own close_engine() on
    # shutdown — engine ownership stays with the session fixture in conftest.
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture
def no_pre_arrival(monkeypatch):
    """Stop POST /api/tickets from spending an OpenAI call on a pre-arrival brief.

    Patched where it's used, not where it's defined: tickets_repo imports the
    symbol into its own namespace, so patching railio.pre_arrival would miss.
    """

    async def _none(**_kw):
        return None

    monkeypatch.setattr("railio.tickets_repo.generate_pre_arrival_summary", _none)
