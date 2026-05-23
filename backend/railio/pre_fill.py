"""Initial form payloads built on ticket creation."""

from __future__ import annotations

from typing import Any

from .contract import Asset

DAILY_229_21_ITEMS: list[dict[str, str]] = [
    {"code": "general_condition",        "cfr_ref": "§229.45",  "label": "General condition — no conditions endangering safety"},
    {"code": "cab_safety_walkways",      "cfr_ref": "§229.119", "label": "Cab — sanitation, walkways, controls, glazing"},
    {"code": "cab_seats_securement",     "cfr_ref": "§229.119", "label": "Cab seats secured; no loose equipment"},
    {"code": "speed_indicator",          "cfr_ref": "§229.117", "label": "Speed indicator visible to engineer; accuracy ±3 mph"},
    {"code": "alerter",                  "cfr_ref": "§229.140", "label": "Alerter operational"},
    {"code": "horn",                     "cfr_ref": "§229.129", "label": "Audible warning device (horn) — sounds at required level"},
    {"code": "bell",                     "cfr_ref": "§229.131", "label": "Bell — operates"},
    {"code": "headlights",               "cfr_ref": "§229.125", "label": "Headlights — operative; aimed correctly"},
    {"code": "auxiliary_lights",         "cfr_ref": "§229.133", "label": "Auxiliary (ditch) lights — operative"},
    {"code": "sanders",                  "cfr_ref": "§229.131", "label": "Sanders — deliver sand to rail"},
    {"code": "marker_lights",            "cfr_ref": "§229.125", "label": "Marker / classification lights — operative"},
    {"code": "windows_glazing",          "cfr_ref": "§229.119", "label": "Cab windows / glazing — clean, unbroken, certified"},
    {"code": "wipers_defrosters",        "cfr_ref": "§229.119", "label": "Windshield wipers and defrosters — operative"},
    {"code": "brakes_air",               "cfr_ref": "§229.46",  "label": "Air brakes — application/release; leakage within limits"},
    {"code": "brakes_independent",       "cfr_ref": "§229.46",  "label": "Independent (locomotive) brake — applies and releases"},
    {"code": "brakes_hand",              "cfr_ref": "§229.46",  "label": "Hand brake — operative"},
    {"code": "couplers",                 "cfr_ref": "§229.45",  "label": "Couplers — secure; no excessive slack"},
    {"code": "pilot_snowplow",           "cfr_ref": "§229.123", "label": "Pilots / snowplow — secured; ground clearance OK"},
    {"code": "trucks_suspension",        "cfr_ref": "§229.55",  "label": "Trucks / suspension — visual; no broken springs"},
    {"code": "wheels",                   "cfr_ref": "§229.71",  "label": "Wheels — no flat spots, shells, or thin flanges"},
    {"code": "fuel_oil_leaks",           "cfr_ref": "§229.45",  "label": "No fuel, oil, water, or coolant leaks endangering safety"},
    {"code": "exposed_electrical",       "cfr_ref": "§229.45",  "label": "No exposed energized electrical conductors"},
    {"code": "fire_extinguishers",       "cfr_ref": "§229.139", "label": "Fire extinguishers present, charged, accessible"},
    {"code": "first_aid_kit",            "cfr_ref": "§229.119", "label": "First-aid kit on board"},
    {"code": "event_recorder",           "cfr_ref": "§229.135", "label": "Event recorder operational"},
    {"code": "fault_codes_cleared",      "cfr_ref": "§229.21",  "label": "Active fault codes addressed or noted"},
]


def build_initial_forms(
    *,
    ticket_id: int,
    asset: Asset,
    opened_at: str,
    initial_error_codes: str | None,
    initial_symptoms: str | None,
    opened_by: str,
) -> dict[str, dict[str, Any]]:
    f6180_49a: dict[str, Any] = {
        "reporting_mark": asset.reporting_mark,
        "road_number": asset.road_number,
        "unit_model": asset.unit_model,
        "build_date": asset.in_service_date,
        "inspection_type": "after_repair",
        "inspection_date": opened_at[:10],
        "previous_inspection_date": (asset.last_inspection_at or "")[:10] or None,
        "place_inspected": "",
        "inspector_name": "",
        "inspector_qualification": "",
        "items": [],
        "defects": [],
        "repairs": [],
        "out_of_service": False,
    }
    daily: dict[str, Any] = {
        "unit": {
            "reporting_mark": asset.reporting_mark,
            "road_number": asset.road_number,
            "unit_model": asset.unit_model,
        },
        "inspector_name": "",
        "inspector_qualification": "",
        "inspected_at": opened_at,
        "place_inspected": "",
        "previous_daily_inspection_at": asset.last_inspection_at,
        "items": [
            {
                "code": it["code"],
                "cfr_ref": it["cfr_ref"],
                "label": it["label"],
                "result": "na",
            }
            for it in DAILY_229_21_ITEMS
        ],
        "exceptions": [],
    }
    return {"F6180_49A": f6180_49a, "DAILY_INSPECTION_229_21": daily}
