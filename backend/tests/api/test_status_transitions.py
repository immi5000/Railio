"""The status legality table, and the HTTP route that must obey it.

PATCH /api/tickets/{ref} used to write status unchecked, so the API could do
AWAITING_TECH → CLOSED while the chat tool refused the same move. These tests
exist to keep that back door shut.
"""

from __future__ import annotations

import pytest

from railio.tools.set_ticket_status import set_ticket_status, transition_error

pytestmark = pytest.mark.db


class TestLegalityTable:
    """transition_error is the single source both callers share."""

    @pytest.mark.parametrize(
        "current,target",
        [
            ("AWAITING_HANDOFF", "AWAITING_TECH"),
            ("AWAITING_TECH", "IN_PROGRESS"),
            ("IN_PROGRESS", "AWAITING_REVIEW"),
            ("AWAITING_REVIEW", "CLOSED"),
            ("AWAITING_REVIEW", "IN_PROGRESS"),
        ],
    )
    def test_allows_the_lifecycle(self, current, target):
        assert transition_error(current, target) is None

    @pytest.mark.parametrize(
        "current,target",
        [
            ("AWAITING_HANDOFF", "IN_PROGRESS"),  # can't skip the handoff
            ("AWAITING_HANDOFF", "CLOSED"),
            ("AWAITING_TECH", "CLOSED"),  # the old back door
            ("AWAITING_TECH", "AWAITING_HANDOFF"),  # no un-handing-off
            ("IN_PROGRESS", "CLOSED"),  # closing goes through wrap-up
            ("CLOSED", "IN_PROGRESS"),
            ("CLOSED", "AWAITING_TECH"),
        ],
    )
    def test_forbids_the_rest(self, current, target):
        assert transition_error(current, target) == f"illegal transition {current} → {target}"

    @pytest.mark.parametrize(
        "status",
        ["AWAITING_HANDOFF", "AWAITING_TECH", "IN_PROGRESS", "AWAITING_REVIEW", "CLOSED"],
    )
    def test_same_status_is_rejected_by_the_table(self, status):
        """Deliberate, and load-bearing: chat_loop fires set_ticket_status on
        every tech message and depends on this rejection to make the
        AWAITING_TECH → IN_PROGRESS move happen exactly once. Idempotence lives
        in the PATCH route, not here."""
        assert transition_error(status, status) is not None


class TestSetTicketStatusTool:
    async def test_legal_move_applies(self, make_ticket, ticket_status):
        tid = await make_ticket(status="AWAITING_TECH")
        assert await set_ticket_status(tid, "IN_PROGRESS") == {
            "ok": True,
            "status": "IN_PROGRESS",
        }
        assert await ticket_status(tid) == "IN_PROGRESS"

    async def test_illegal_move_is_refused_and_changes_nothing(
        self, make_ticket, ticket_status
    ):
        tid = await make_ticket(status="AWAITING_TECH")
        out = await set_ticket_status(tid, "CLOSED")
        assert "illegal transition" in out["error"]
        assert await ticket_status(tid) == "AWAITING_TECH"

    async def test_unknown_ticket(self):
        out = await set_ticket_status(-1, "IN_PROGRESS")
        assert "not found" in out["error"]


class TestPatchRoute:
    async def test_handoff_is_allowed(self, client, make_ticket, ticket_short_id, ticket_status):
        tid = await make_ticket(status="AWAITING_HANDOFF")
        ref = await ticket_short_id(tid)
        r = await client.patch(f"/api/tickets/{ref}", json={"status": "AWAITING_TECH"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "AWAITING_TECH"
        assert await ticket_status(tid) == "AWAITING_TECH"

    async def test_illegal_jump_is_rejected(
        self, client, make_ticket, ticket_short_id, ticket_status
    ):
        """The regression this whole file is here for."""
        tid = await make_ticket(status="AWAITING_TECH")
        ref = await ticket_short_id(tid)
        r = await client.patch(f"/api/tickets/{ref}", json={"status": "CLOSED"})
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        assert "illegal transition" in r.json()["detail"]
        assert await ticket_status(tid) == "AWAITING_TECH", "rejected but still wrote"

    async def test_same_status_succeeds(self, client, make_ticket, ticket_short_id):
        tid = await make_ticket(status="AWAITING_TECH")
        ref = await ticket_short_id(tid)
        r = await client.patch(f"/api/tickets/{ref}", json={"status": "AWAITING_TECH"})
        assert r.status_code == 200, r.text

    async def test_closing_from_review_stamps_closed_at(
        self, client, make_ticket, ticket_short_id
    ):
        tid = await make_ticket(status="AWAITING_REVIEW")
        ref = await ticket_short_id(tid)
        r = await client.patch(f"/api/tickets/{ref}", json={"status": "CLOSED"})
        assert r.status_code == 200, r.text
        assert r.json()["closed_at"], "closed without a closed_at timestamp"

    async def test_non_status_fields_still_patch(self, client, make_ticket, ticket_short_id):
        tid = await make_ticket(status="AWAITING_TECH")
        ref = await ticket_short_id(tid)
        r = await client.patch(f"/api/tickets/{ref}", json={"severity": "critical"})
        assert r.status_code == 200, r.text
        assert r.json()["severity"] == "critical"

    async def test_invalid_severity_rejected(self, client, make_ticket, ticket_short_id):
        tid = await make_ticket()
        ref = await ticket_short_id(tid)
        r = await client.patch(f"/api/tickets/{ref}", json={"severity": "catastrophic"})
        assert r.status_code == 422 or r.status_code == 400

    async def test_empty_patch_rejected(self, client, make_ticket, ticket_short_id):
        tid = await make_ticket()
        ref = await ticket_short_id(tid)
        r = await client.patch(f"/api/tickets/{ref}", json={})
        assert r.status_code == 400
