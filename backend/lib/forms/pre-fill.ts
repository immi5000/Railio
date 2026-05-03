import type {
  Asset,
  F6180_49A,
  DailyInspection_229_21,
} from "@contract/contract";

type Inputs = {
  ticket_id: number;
  asset: Asset;
  opened_at: string;
  initial_error_codes: string | null;
  initial_symptoms: string | null;
  opened_by: string;
};

// 49 CFR §229.21 daily inspection checklist.
// Each item references the underlying CFR section that defines the requirement.
// Items pre-fill with result="na"; the tech (or chat) marks pass/fail per item.
const DAILY_229_21_ITEMS: { code: string; cfr_ref: string; label: string }[] = [
  { code: "general_condition",        cfr_ref: "§229.45",  label: "General condition — no conditions endangering safety" },
  { code: "cab_safety_walkways",      cfr_ref: "§229.119", label: "Cab — sanitation, walkways, controls, glazing" },
  { code: "cab_seats_securement",     cfr_ref: "§229.119", label: "Cab seats secured; no loose equipment" },
  { code: "speed_indicator",          cfr_ref: "§229.117", label: "Speed indicator visible to engineer; accuracy ±3 mph" },
  { code: "alerter",                  cfr_ref: "§229.140", label: "Alerter operational" },
  { code: "horn",                     cfr_ref: "§229.129", label: "Audible warning device (horn) — sounds at required level" },
  { code: "bell",                     cfr_ref: "§229.131", label: "Bell — operates" },
  { code: "headlights",               cfr_ref: "§229.125", label: "Headlights — operative; aimed correctly" },
  { code: "auxiliary_lights",         cfr_ref: "§229.133", label: "Auxiliary (ditch) lights — operative" },
  { code: "sanders",                  cfr_ref: "§229.131", label: "Sanders — deliver sand to rail" },
  { code: "marker_lights",            cfr_ref: "§229.125", label: "Marker / classification lights — operative" },
  { code: "windows_glazing",          cfr_ref: "§229.119", label: "Cab windows / glazing — clean, unbroken, certified" },
  { code: "wipers_defrosters",        cfr_ref: "§229.119", label: "Windshield wipers and defrosters — operative" },
  { code: "brakes_air",               cfr_ref: "§229.46",  label: "Air brakes — application/release; leakage within limits" },
  { code: "brakes_independent",       cfr_ref: "§229.46",  label: "Independent (locomotive) brake — applies and releases" },
  { code: "brakes_hand",              cfr_ref: "§229.46",  label: "Hand brake — operative" },
  { code: "couplers",                 cfr_ref: "§229.45",  label: "Couplers — secure; no excessive slack" },
  { code: "pilot_snowplow",           cfr_ref: "§229.123", label: "Pilots / snowplow — secured; ground clearance OK" },
  { code: "trucks_suspension",        cfr_ref: "§229.55",  label: "Trucks / suspension — visual; no broken springs" },
  { code: "wheels",                   cfr_ref: "§229.71",  label: "Wheels — no flat spots, shells, or thin flanges" },
  { code: "fuel_oil_leaks",           cfr_ref: "§229.45",  label: "No fuel, oil, water, or coolant leaks endangering safety" },
  { code: "exposed_electrical",       cfr_ref: "§229.45",  label: "No exposed energized electrical conductors" },
  { code: "fire_extinguishers",       cfr_ref: "§229.139", label: "Fire extinguishers present, charged, accessible" },
  { code: "first_aid_kit",            cfr_ref: "§229.119", label: "First-aid kit on board" },
  { code: "event_recorder",           cfr_ref: "§229.135", label: "Event recorder operational" },
  { code: "fault_codes_cleared",      cfr_ref: "§229.21",  label: "Active fault codes addressed or noted" },
];

export function buildInitialForms(inp: Inputs) {
  const f6180_49A: F6180_49A = {
    reporting_mark: inp.asset.reporting_mark,
    road_number: inp.asset.road_number,
    unit_model: inp.asset.unit_model,
    build_date: inp.asset.in_service_date ?? undefined,
    inspection_type: "after_repair",
    inspection_date: inp.opened_at.slice(0, 10),
    previous_inspection_date: inp.asset.last_inspection_at?.slice(0, 10),
    place_inspected: "",
    inspector_name: "",
    inspector_qualification: "",
    items: [],
    defects: [],
    repairs: [],
    out_of_service: false,
  };

  const daily: DailyInspection_229_21 = {
    unit: {
      reporting_mark: inp.asset.reporting_mark,
      road_number: inp.asset.road_number,
      unit_model: inp.asset.unit_model,
    },
    inspector_name: "",
    inspector_qualification: "",
    inspected_at: inp.opened_at,
    place_inspected: "",
    previous_daily_inspection_at: inp.asset.last_inspection_at ?? undefined,
    items: DAILY_229_21_ITEMS.map((it) => ({
      code: it.code,
      cfr_ref: it.cfr_ref,
      label: it.label,
      result: "na",
    })),
    exceptions: [],
  };

  return {
    F6180_49A: f6180_49A,
    DAILY_INSPECTION_229_21: daily,
  } as const;
}
