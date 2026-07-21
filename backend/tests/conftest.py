"""Shared fixtures.

Everything here runs against a live Postgres and the `unit_tests` org. Nothing
here seeds: `copy_org` wipes its destination before writing, so a fixture that
seeded would let parallel xdist workers delete each other's data mid-run.
Seeding is a manual pre-step; these fixtures only verify it happened and fail
with the command to run.
"""

from __future__ import annotations

import os

import pytest
from dotenv import load_dotenv

load_dotenv()

# Mirror the scripts: prefer the direct connection over the transaction pooler.
# Must happen before the first get_settings() call, which is lru_cached.
if os.environ.get("DATABASE_URL_DIRECT"):
    os.environ["DATABASE_URL"] = os.environ["DATABASE_URL_DIRECT"]

from sqlalchemy import text  # noqa: E402

from railio.db import close_engine, get_engine, session_scope  # noqa: E402
from railio.messages_repo import _iso_now  # noqa: E402
from railio.model_family import _sql_family  # noqa: E402
from railio.tickets_repo import _gen_short_id, delete_ticket  # noqa: E402
from railio.tools.lookup_parts import lookup_parts  # noqa: E402

TEST_ORG_SLUG = "unit_tests"
SOURCE_ORG_SLUG = "test"
SEED_CMD = f"cd backend && python -m scripts.copy_org {SOURCE_ORG_SLUG} {TEST_ORG_SLUG}"

# Only some unit models have figure-bearing manual chunks, so show_figure is
# untestable on the others. Preferred pick; the fixture falls back to any model
# that qualifies.
PREFERRED_FIGURE_MODEL = "EMD GP38-2"

# A part keyword the seeded catalog actually stocks. "brake shoe" returns zero.
STOCK_PART_QUERY = "injector"


def pytest_addoption(parser):
    parser.addoption(
        "--keep-test-data",
        action="store_true",
        default=False,
        help="don't delete tickets created by tests (for debugging a failure)",
    )


def _seed_fail(what: str):
    pytest.fail(
        f"\n\nTest org `{TEST_ORG_SLUG}` {what}.\n"
        f"Seed it with:\n\n    {SEED_CMD}\n\n"
        f"That copies assets, parts, history, tickets and private corpus from the\n"
        f"`{SOURCE_ORG_SLUG}` org. It costs no OpenAI tokens: nothing is rewritten,\n"
        f"so nothing is re-embedded. Shared OEM manuals and their figures are\n"
        f"org_id IS NULL and already visible to every org — they are not copied.\n",
        pytrace=False,
    )


@pytest.fixture(scope="session", autouse=True)
async def _engine():
    get_engine()
    yield
    await close_engine()


@pytest.fixture(scope="session")
async def org_id(_engine) -> int:
    async with session_scope() as s:
        row = (
            await s.execute(
                text("SELECT id FROM organizations WHERE slug = :s"),
                {"s": TEST_ORG_SLUG},
            )
        ).scalar_one_or_none()
    if row is None:
        _seed_fail("does not exist")
    return int(row)


@pytest.fixture(scope="session")
async def other_org_id(_engine) -> int:
    """A second tenant, for proving the org boundary holds."""
    async with session_scope() as s:
        row = (
            await s.execute(
                text("SELECT id FROM organizations WHERE slug = :s"),
                {"s": SOURCE_ORG_SLUG},
            )
        ).scalar_one_or_none()
    if row is None:
        pytest.fail(f"source org `{SOURCE_ORG_SLUG}` not found", pytrace=False)
    return int(row)


@pytest.fixture(scope="session", autouse=True)
async def _seed_sanity(org_id):
    """Fail specifically, before any test burns an OpenAI call."""
    async with session_scope() as s:
        counts = (
            await s.execute(
                text(
                    """
                    SELECT (SELECT count(*) FROM assets WHERE org_id = :o) AS assets,
                           (SELECT count(*) FROM parts  WHERE org_id = :o) AS parts,
                           (SELECT count(*) FROM corpus_chunks WHERE org_id = :o) AS chunks
                    """
                ),
                {"o": org_id},
            )
        ).mappings().one()
    for name, n in counts.items():
        if n == 0:
            _seed_fail(f"has 0 {name}")


@pytest.fixture(scope="session")
async def figure_asset(org_id) -> dict:
    """An in-service asset whose model has figure-bearing chunks visible to us.

    Selecting on figure availability is not fussiness: only three seeded models
    have figures at all, so "first asset" silently makes show_figure untestable.
    The family predicate reuses _sql_family so this fixture cannot disagree with
    search_corpus's own model matching.
    """
    fam_asset = _sql_family("a.unit_model")
    fam_chunk = _sql_family("c.unit_model")
    sql = text(
        f"""
        SELECT a.id, a.unit_model, a.reporting_mark, a.road_number
        FROM assets a
        WHERE a.org_id = :o
          AND a.out_of_service = false
          AND EXISTS (
            SELECT 1 FROM corpus_chunks c
            WHERE (c.org_id = :o OR c.org_id IS NULL)
              -- Many rows store figures as JSON null, and jsonb_array_length
              -- errors on a scalar. A sibling jsonb_typeof guard does NOT save
              -- you — the planner is free to evaluate the length first, and it
              -- does. Comparing against '[]' is total over every JSON type.
              AND jsonb_typeof(c.figures) = 'array'
              AND c.figures <> '[]'::jsonb
              AND {fam_chunk} = {fam_asset}
          )
        ORDER BY (a.unit_model = :pref) DESC, a.id
        LIMIT 1
        """
    )
    async with session_scope() as s:
        row = (await s.execute(sql, {"o": org_id, "pref": PREFERRED_FIGURE_MODEL})).mappings().first()
    if not row:
        _seed_fail("has no in-service asset whose model has figure-bearing corpus chunks")
    return dict(row)


@pytest.fixture(scope="session")
async def stock_part(org_id, figure_asset) -> dict:
    """A real part, found through the same tool the model uses.

    Going through lookup_parts rather than raw SQL means the fixture and the tool
    can never disagree about what "in stock" means.
    """
    res = await lookup_parts(figure_asset["unit_model"], STOCK_PART_QUERY, org_id=org_id)
    if not res.get("matches"):
        _seed_fail(f"has no part matching {STOCK_PART_QUERY!r}")
    return res["matches"][0]


@pytest.fixture
async def make_ticket(org_id, figure_asset, request):
    """Fresh ticket per test, so message history never leaks between them."""
    created: list[int] = []

    async def _make(
        *,
        asset_id: int | None = None,
        symptoms: str | None = None,
        error_codes: str | None = None,
        fault_dump_raw: str | None = None,
        severity: str = "major",
        status: str = "AWAITING_TECH",
        org: int | None = None,
    ) -> int:
        # Deliberately not tickets_repo.create_ticket: that fires
        # generate_pre_arrival_summary, a live OpenAI call, on every ticket.
        # Leaving pre_arrival_summary NULL also keeps TICKET CONTEXT small.
        async with session_scope() as s:
            short_id = _gen_short_id()
            for _ in range(6):
                taken = (
                    await s.execute(
                        text("SELECT 1 FROM tickets WHERE short_id = :s"), {"s": short_id}
                    )
                ).first()
                if not taken:
                    break
                short_id = _gen_short_id()
            tid = (
                await s.execute(
                    text(
                        """
                        INSERT INTO tickets (
                            org_id, asset_id, title, short_id, status, severity,
                            opened_by_role, opened_at, initial_error_codes,
                            initial_symptoms, fault_dump_raw
                        )
                        VALUES (:o, :a, :t, :s, :st, :sev, 'dispatcher', :at, :err, :sym, :raw)
                        RETURNING id
                        """
                    ),
                    {
                        "o": org if org is not None else org_id,
                        "a": asset_id if asset_id is not None else figure_asset["id"],
                        "t": "unit-test ticket",
                        "s": short_id,
                        "st": status,
                        "sev": severity,
                        "at": _iso_now(),
                        "err": error_codes,
                        "sym": symptoms,
                        "raw": fault_dump_raw,
                    },
                )
            ).scalar_one()
        created.append(int(tid))
        return int(tid)

    yield _make

    if not request.config.getoption("--keep-test-data"):
        for tid in created:
            # Whole tickets, never individual messages: the hash chain is
            # per-ticket, so deleting a subset would break verify_chain, while
            # deleting the ticket removes its chain entirely. delete_ticket
            # already cascades messages, ticket_parts, tribal_capture and any
            # promoted corpus chunk.
            await delete_ticket(tid, org_id)


@pytest.fixture(scope="session")
async def chunk_owners():
    """chunk_id -> owning org_id (None = shared reference data like CFR)."""

    async def _get(ids) -> dict[int, int | None]:
        ids = list(ids)
        if not ids:
            return {}
        async with session_scope() as s:
            rows = (
                await s.execute(
                    text("SELECT id, org_id FROM corpus_chunks WHERE id = ANY(:ids)"),
                    {"ids": ids},
                )
            ).mappings().all()
        return {r["id"]: r["org_id"] for r in rows}

    return _get


@pytest.fixture(scope="session")
async def part_owners():
    """part_id -> owning org_id. Parts are always org-private."""

    async def _get(ids) -> dict[int, int]:
        ids = list(ids)
        if not ids:
            return {}
        async with session_scope() as s:
            rows = (
                await s.execute(
                    text("SELECT id, org_id FROM parts WHERE id = ANY(:ids)"),
                    {"ids": ids},
                )
            ).mappings().all()
        return {r["id"]: r["org_id"] for r in rows}

    return _get


@pytest.fixture
async def ticket_short_id():
    async def _get(ticket_id: int) -> str:
        async with session_scope() as s:
            return (
                await s.execute(
                    text("SELECT short_id FROM tickets WHERE id = :id"), {"id": ticket_id}
                )
            ).scalar_one()

    return _get


@pytest.fixture
async def ticket_status():
    async def _get(ticket_id: int) -> str:
        async with session_scope() as s:
            return (
                await s.execute(
                    text("SELECT status FROM tickets WHERE id = :id"), {"id": ticket_id}
                )
            ).scalar_one()

    return _get
