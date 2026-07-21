"""Ticket lifecycle over HTTP, plus a shape smoke test over the read routes.

Cheap, and they're what catch a router that stopped booting or a response that
quietly lost a field the frontend reads.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.db


class TestCreate:
    async def test_new_tickets_open_awaiting_handoff(
        self, client, figure_asset, no_pre_arrival
    ):
        """A ticket is the dispatcher's until they hand it off — it must not
        land straight in the tech's queue."""
        r = await client.post(
            "/api/tickets",
            json={
                "asset_id": figure_asset["id"],
                "opened_by_role": "dispatcher",
                "severity": "major",
                "initial_symptoms": "unit-test intake",
            },
        )
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body["status"] == "AWAITING_HANDOFF"
        assert body["short_id"]
        await client.delete(f"/api/tickets/{body['short_id']}")

    async def test_create_then_get_round_trips(self, client, figure_asset, no_pre_arrival):
        r = await client.post(
            "/api/tickets",
            json={
                "asset_id": figure_asset["id"],
                "opened_by_role": "dispatcher",
                "severity": "critical",
                "initial_symptoms": "round trip",
                "initial_error_codes": "E-101,E-102",
            },
        )
        ref = r.json()["short_id"]
        try:
            g = await client.get(f"/api/tickets/{ref}")
            assert g.status_code == 200
            body = g.json()
            assert body["severity"] == "critical"
            assert body["initial_symptoms"] == "round trip"
            assert body["asset"]["id"] == figure_asset["id"]
            assert body["messages"] == []
            assert body["ticket_parts"] == []
        finally:
            await client.delete(f"/api/tickets/{ref}")


class TestParts:
    async def test_add_and_remove_a_part(
        self, client, make_ticket, ticket_short_id, stock_part
    ):
        ref = await ticket_short_id(await make_ticket())
        r = await client.post(
            f"/api/tickets/{ref}/parts", json={"part_id": stock_part["id"], "qty": 2}
        )
        assert r.status_code == 200, r.text
        parts = r.json()["ticket_parts"]
        added = next((p for p in parts if p["part_id"] == stock_part["id"]), None)
        assert added is not None, f"part not attached: {parts}"
        assert added["qty"] == 2
        assert added["added_via"] == "tech_manual", (
            "a part added through the API is a manual add, not an AI suggestion"
        )

        r = await client.delete(f"/api/tickets/{ref}/parts/{stock_part['id']}")
        assert r.status_code == 200, r.text
        assert not any(p["part_id"] == stock_part["id"] for p in r.json()["ticket_parts"])


class TestUnknownRefs:
    @pytest.mark.parametrize("method", ["get", "patch", "delete"])
    async def test_nonexistent_ticket_404s(self, client, method):
        kw = {"json": {"severity": "minor"}} if method == "patch" else {}
        r = await getattr(client, method)("/api/tickets/ZZZZZZ", **kw)
        assert r.status_code == 404


class TestReadRoutesRespond:
    """Shape only — these exist to catch a router that stopped importing."""

    async def test_health(self, client):
        r = await client.get("/")
        assert r.status_code == 200
        assert r.json()["ok"] is True

    async def test_list_tickets(self, client):
        r = await client.get("/api/tickets")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    async def test_list_assets(self, client):
        r = await client.get("/api/assets")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    async def test_list_parts_is_paginated(self, client):
        r = await client.get("/api/parts", params={"limit": 5})
        assert r.status_code == 200
        body = r.json()
        assert len(body["parts"]) <= 5
        assert isinstance(body["total"], int)
        assert body["total"] >= len(body["parts"])

    async def test_parts_filter_options(self, client):
        r = await client.get("/api/parts/filter-options")
        assert r.status_code == 200
        body = r.json()
        for key in ("locations", "suppliers", "departments"):
            assert isinstance(body[key], list), f"{key} missing from filter options"

    async def test_corpus_models(self, client):
        r = await client.get("/api/corpus/models")
        assert r.status_code == 200
        assert isinstance(r.json()["models"], list)

    async def test_corpus_documents(self, client):
        r = await client.get("/api/corpus/documents")
        assert r.status_code == 200
        assert isinstance(r.json()["documents"], list)

    async def test_me(self, client, org_id):
        r = await client.get("/api/me")
        assert r.status_code == 200
        body = r.json()
        assert body["profile_completed"] is True
        assert body["org"]["id"] == org_id
