"""model_family() unit battery + Python↔SQL agreement.

The retrieval predicate normalizes models in SQL (search_corpus._sql_family),
mirroring the Python model_family(). These tests lock the battery and assert the
two implementations agree against real Postgres (POSIX ERE vs Python re can
differ, so this must run against the actual DB).
"""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import text

from railio.db import session_scope
from railio.model_family import _sql_family, model_family

# (input, expected family)
BATTERY = [
    ("EMD SD60M", "SD60"),
    ("EMD SD60", "SD60"),
    ("SD60I", "SD60"),
    ("EMD GP38-2", "GP38-2"),
    ("EMD SD38-2", "SD38-2"),
    ("GE ES44DC", "ES44"),
    ("GE ES44AC", "ES44"),  # AC/DC collapse is intended
    ("EMD SD70ACe", "SD70"),
    ("SD60", "SD60"),
    ("GP38", "GP38"),
    ("EMD SD70M", "SD70"),
    ("  emd   sd60m ", "SD60"),  # lowercase + extra whitespace
    ("GENERAL ELECTRIC ES44", "ES44"),  # multi-word OEM
]


@pytest.mark.parametrize("raw,expected", BATTERY)
def test_model_family_battery(raw, expected):
    assert model_family(raw) == expected


def test_model_family_none():
    assert model_family(None) is None


def test_python_sql_agreement():
    """The SQL family expression must produce the same family as Python for
    every battery input, against real Postgres. Runs the whole battery in ONE
    event loop — the async engine in railio.db is a loop-bound singleton, so a
    per-input asyncio.run() would reuse a closed loop."""

    async def run() -> None:
        from railio.db import close_engine

        try:
            async with session_scope() as s:
                for raw, expected in BATTERY:
                    fam = (
                        await s.execute(
                            text(f"SELECT {_sql_family(':v')} AS fam"), {"v": raw}
                        )
                    ).scalar_one()
                    assert fam == expected == model_family(raw), (
                        f"{raw!r}: sql={fam!r} py={model_family(raw)!r} "
                        f"expected={expected!r}"
                    )
        finally:
            await close_engine()

    asyncio.run(run())
