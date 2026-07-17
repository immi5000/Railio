"""The tenant boundary.

Every request here is authenticated as the unit_tests org and reaches for the
`test` org's data. A cross-org id must resolve to nothing — 404, not 403, since
the row simply isn't visible. This is the file that should fail loudest if the
org seam ever regresses.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from railio.db import session_scope

pytestmark = pytest.mark.db


@pytest.fixture(scope="session")
async def other_org_ticket_ref(other_org_id) -> str:
    async with session_scope() as s:
        ref = (
            await s.execute(
                text("SELECT short_id FROM tickets WHERE org_id = :o ORDER BY id LIMIT 1"),
                {"o": other_org_id},
            )
        ).scalar_one_or_none()
    if not ref:
        pytest.skip("source org has no tickets to attempt cross-tenant access against")
    return ref


@pytest.fixture(scope="session")
async def other_org_asset_id(other_org_id) -> int:
    async with session_scope() as s:
        return (
            await s.execute(
                text("SELECT id FROM assets WHERE org_id = :o ORDER BY id LIMIT 1"),
                {"o": other_org_id},
            )
        ).scalar_one()


@pytest.fixture(scope="session")
async def other_org_part_id(other_org_id) -> int:
    async with session_scope() as s:
        return (
            await s.execute(
                text("SELECT id FROM parts WHERE org_id = :o ORDER BY id LIMIT 1"),
                {"o": other_org_id},
            )
        ).scalar_one()


class TestTicketsAreScoped:
    async def test_get_other_orgs_ticket_404s(self, client, other_org_ticket_ref):
        r = await client.get(f"/api/tickets/{other_org_ticket_ref}")
        assert r.status_code == 404

    async def test_patch_other_orgs_ticket_404s(self, client, other_org_ticket_ref):
        r = await client.patch(
            f"/api/tickets/{other_org_ticket_ref}", json={"severity": "minor"}
        )
        assert r.status_code == 404

    async def test_delete_other_orgs_ticket_404s(self, client, other_org_ticket_ref):
        r = await client.delete(f"/api/tickets/{other_org_ticket_ref}")
        assert r.status_code == 404

    async def test_list_returns_only_our_tickets(self, client, org_id):
        r = await client.get("/api/tickets")
        assert r.status_code == 200
        for t in r.json():
            assert t["org_id"] == org_id, f"ticket {t['short_id']} belongs to {t['org_id']}"

    async def test_cannot_open_a_ticket_on_another_orgs_asset(
        self, client, other_org_asset_id, no_pre_arrival
    ):
        r = await client.post(
            "/api/tickets",
            json={
                "asset_id": other_org_asset_id,
                "opened_by_role": "dispatcher",
                "severity": "major",
                "initial_symptoms": "cross-tenant attempt",
            },
        )
        assert r.status_code in (400, 404), f"created a ticket on another org's asset: {r.text}"


class TestPartsAreScoped:
    async def test_list_returns_only_our_parts(self, client, org_id, part_owners):
        r = await client.get("/api/parts", params={"limit": 200})
        assert r.status_code == 200
        ids = [p["id"] for p in r.json()["parts"]]
        owners = await part_owners(ids)
        leaked = {p: o for p, o in owners.items() if o != org_id}
        assert not leaked, f"list_parts leaked another org's parts: {leaked}"

    async def test_patch_other_orgs_part_404s(self, client, other_org_part_id):
        r = await client.patch(f"/api/parts/{other_org_part_id}", json={"name": "hijacked"})
        assert r.status_code == 404

    async def test_cannot_attach_another_orgs_part_to_our_ticket(
        self, client, make_ticket, ticket_short_id, other_org_part_id
    ):
        tid = await make_ticket()
        ref = await ticket_short_id(tid)
        r = await client.post(
            f"/api/tickets/{ref}/parts", json={"part_id": other_org_part_id, "qty": 1}
        )
        assert r.status_code == 404, f"attached another org's part: {r.text}"


class TestAssetsAndCorpusAreScoped:
    async def test_assets_list_is_ours(self, client, org_id):
        r = await client.get("/api/assets")
        assert r.status_code == 200
        for a in r.json():
            assert a["org_id"] == org_id

    async def test_patch_other_orgs_asset_404s(self, client, other_org_asset_id):
        # A full valid body on purpose: an incomplete one 422s in validation and
        # never reaches the org check, which would make this pass without
        # proving anything.
        r = await client.patch(
            f"/api/assets/{other_org_asset_id}",
            json={
                "reporting_mark": "HIJK",
                "road_number": "9999",
                "unit_model": "EMD GP38-2",
                "out_of_service": True,
            },
        )
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text}"

    async def test_corpus_chunks_are_ours_or_shared(self, client, org_id, chunk_owners):
        r = await client.get("/api/corpus/chunks", params={"limit": 100})
        assert r.status_code == 200
        ids = [c["id"] for c in r.json()["chunks"]]
        owners = await chunk_owners(ids)
        leaked = {c: o for c, o in owners.items() if o is not None and o != org_id}
        assert not leaked, f"corpus listing leaked another org's chunks: {leaked}"
