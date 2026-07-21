"""PATCH /api/parts/{id} normalizes a locations edit server-side.

The invariant being defended is qty_on_hand == sum(locations): the UI lets you
edit either, and if they drift the parts screen starts lying about stock. All
pure logic, no OpenAI.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.db


@pytest.fixture
async def part(client, org_id):
    """A throwaway part, deleted by nobody — so give it a unique number."""
    import uuid

    number = f"UT-{uuid.uuid4().hex[:10].upper()}"
    r = await client.post(
        "/api/parts",
        json={
            "part_number": number,
            "name": "unit-test widget",
            "compatible_units": [],
            "qty_on_hand": 0,
        },
    )
    assert r.status_code in (200, 201), r.text
    return r.json()


async def _patch(client, part, **body):
    r = await client.patch(f"/api/parts/{part['id']}", json=body)
    return r


class TestQtyIsDerivedFromLocations:
    async def test_qty_is_the_sum(self, client, part):
        r = await _patch(
            client,
            part,
            locations=[
                {"location": "A1", "qty": 4, "avg_cost": 10.0},
                {"location": "B2", "qty": 6, "avg_cost": 10.0},
            ],
        )
        assert r.status_code == 200, r.text
        assert r.json()["qty_on_hand"] == 10

    async def test_fractional_quantities_round_to_an_int_total(self, client, part):
        r = await _patch(
            client,
            part,
            locations=[
                {"location": "A1", "qty": 1.5, "avg_cost": 2.0},
                {"location": "B2", "qty": 1.5, "avg_cost": 2.0},
            ],
        )
        assert r.status_code == 200, r.text
        assert r.json()["qty_on_hand"] == 3

    async def test_blank_named_rows_are_dropped(self, client, part):
        r = await _patch(
            client,
            part,
            locations=[
                {"location": "A1", "qty": 5, "avg_cost": 1.0},
                {"location": "   ", "qty": 99, "avg_cost": 1.0},
            ],
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert [loc["location"] for loc in body["locations"]] == ["A1"]
        assert body["qty_on_hand"] == 5, "a dropped row still counted toward the total"

    async def test_empty_locations_does_not_zero_the_qty(self, client, part):
        """The `if normalized:` guard — easy to "simplify" away, load-bearing.

        Clearing the breakdown means "I no longer track this per-location", not
        "there are zero on hand".
        """
        await _patch(client, part, locations=[{"location": "A1", "qty": 7, "avg_cost": 1.0}])
        r = await _patch(client, part, locations=[])
        assert r.status_code == 200, r.text
        assert r.json()["qty_on_hand"] == 7, "clearing locations wiped the stock count"


class TestValueIsServerDerived:
    async def test_row_value_is_qty_times_cost(self, client, part):
        r = await _patch(
            client, part, locations=[{"location": "A1", "qty": 3, "avg_cost": 2.5}]
        )
        assert r.status_code == 200, r.text
        assert r.json()["locations"][0]["value"] == 7.5

    async def test_missing_cost_gives_no_value(self, client, part):
        r = await _patch(
            client, part, locations=[{"location": "A1", "qty": 3, "avg_cost": None}]
        )
        assert r.status_code == 200, r.text
        assert r.json()["locations"][0]["value"] is None

    async def test_client_supplied_on_hand_value_is_ignored(self, client, part):
        """A stale total must not outlive an edit to the inputs it derives from."""
        r = await _patch(
            client,
            part,
            locations=[{"location": "A1", "qty": 2, "avg_cost": 5.0}],
            on_hand_value=999999.0,
        )
        assert r.status_code == 200, r.text
        assert r.json()["on_hand_value"] != 999999.0


class TestRejections:
    async def test_malformed_locations_400(self, client, part):
        r = await _patch(client, part, locations=[{"nope": True}])
        assert r.status_code == 400
        assert r.json()["detail"] == "bad locations"

    async def test_no_valid_fields_400(self, client, part):
        r = await _patch(client, part, not_a_column="x")
        assert r.status_code == 400

    async def test_duplicate_part_number_409(self, client, part):
        r = await client.post(
            "/api/parts",
            json={"part_number": part["part_number"], "name": "clash", "qty_on_hand": 0},
        )
        assert r.status_code == 409
