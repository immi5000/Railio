// Derived FRA periodic-inspection status. Single home for the due/overdue logic
// consumed by FleetAdmin, the dashboard fleet table, and RepairContext — so the
// rule (next due = last + interval) lives in exactly one place.
//
// The contract module is type-only (never bundled — it lives outside the Next.js
// root and is consumed via `import type`), so this runtime constant lives here.
// Keep in sync with INSPECTION_INTERVALS in backend/railio/contract.py.
import type { Asset, OosPeriod } from "@/lib/contract";

type InspectionField = "last_92_day_at" | "last_368_day_at" | "last_1104_day_at";

// 49 CFR §229.23 periodic inspection intervals (days).
export const INSPECTION_INTERVALS: ReadonlyArray<{
  key: string;
  label: string;
  days: number;
  field: InspectionField;
}> = [
  { key: "92_day", label: "92-Day", days: 92, field: "last_92_day_at" },
  { key: "368_day", label: "368-Day", days: 368, field: "last_368_day_at" },
  { key: "1104_day", label: "1104-Day", days: 1104, field: "last_1104_day_at" },
];

export type InspectionState = "ok" | "due_soon" | "overdue" | "unknown";

export type InspectionStatus = {
  key: string;
  label: string;
  field: InspectionField;
  last: string | null;
  nextDue: string | null; // YYYY-MM-DD (adjusted for OOS credit)
  state: InspectionState;
  oosCredit: number; // days added to the due date for out-of-service time (0 = none)
};

const DUE_SOON_DAYS = 14;
const DAY_MS = 86_400_000;
// An outage must EXCEED this to pause the inspection clock (49 CFR out-of-service
// credit). Once it does, ALL of its qualifying days count — the threshold only
// gates whether the outage counts, not how much.
const OOS_MIN_DAYS = 30;

function parseDay(d: string | null): Date | null {
  if (!d) return null;
  const dt = new Date(`${d.slice(0, 10)}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function todayMidnight(): Date {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

// Full outage length in days (open period => ends today). Used ONLY for the
// >30-day gate — it looks at the raw outage, not the inspection window.
function periodDurationDays(p: OosPeriod, today: Date): number {
  const start = parseDay(p.started_at);
  if (!start) return 0;
  const end = p.ended_at ? parseDay(p.ended_at) : today;
  if (!end) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY_MS));
}

// Days of an outage that fall inside [windowStart, today] — the portion clipped
// to the current inspection cycle. Open period => ends today.
function overlapDays(p: OosPeriod, windowStart: Date, today: Date): number {
  const start = parseDay(p.started_at);
  if (!start) return 0;
  const end = p.ended_at ? parseDay(p.ended_at) : today;
  if (!end) return 0;
  const lo = Math.max(start.getTime(), windowStart.getTime());
  const hi = Math.min(end.getTime(), today.getTime());
  if (hi <= lo) return 0;
  return Math.round((hi - lo) / DAY_MS);
}

// Total OOS days to add to a due date whose inspection window opened at
// `windowStart`. Gate (>30) uses the FULL outage; the amount added uses the
// CLIPPED overlap, so an outage before the last inspection contributes nothing.
export function qualifyingOosDays(
  asset: Asset,
  windowStart: Date,
  today: Date,
): number {
  let total = 0;
  for (const p of asset.oos_periods ?? []) {
    if (periodDurationDays(p, today) > OOS_MIN_DAYS) {
      total += overlapDays(p, windowStart, today);
    }
  }
  return total;
}

export function inspectionStatuses(asset: Asset): InspectionStatus[] {
  const today = todayMidnight();
  return INSPECTION_INTERVALS.map((interval) => {
    const last = (asset[interval.field] as string | null) ?? null;
    const lastDt = parseDay(last);
    if (!lastDt) {
      return {
        key: interval.key,
        label: interval.label,
        field: interval.field,
        last,
        nextDue: null,
        state: "unknown" as const,
        oosCredit: 0,
      };
    }
    // Push the due date out by the qualifying OOS days that fall within this
    // interval's window (last inspection → today), so idle time doesn't count.
    const oosCredit = qualifyingOosDays(asset, lastDt, today);
    const baselineDue = lastDt.getTime() + interval.days * DAY_MS;
    const due = new Date(baselineDue + oosCredit * DAY_MS);
    const daysLeft = Math.round((due.getTime() - today.getTime()) / DAY_MS);
    const state: InspectionState =
      daysLeft < 0 ? "overdue" : daysLeft <= DUE_SOON_DAYS ? "due_soon" : "ok";
    return {
      key: interval.key,
      label: interval.label,
      field: interval.field,
      last,
      nextDue: due.toISOString().slice(0, 10),
      state,
      oosCredit,
    };
  });
}

const RANK: Record<InspectionState, number> = {
  overdue: 0,
  due_soon: 1,
  ok: 2,
  unknown: 3,
};

// The single most-urgent inspection (overdue beats due-soon beats ok), used for
// the compact dashboard "Next due" cell and for status filtering.
export function mostUrgent(asset: Asset): InspectionStatus {
  return inspectionStatuses(asset)
    .slice()
    .sort((a, b) => {
      if (RANK[a.state] !== RANK[b.state]) return RANK[a.state] - RANK[b.state];
      return (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999");
    })[0];
}

// Integer days a unit has been out of service, or null if unknown / in service.
export function oosDays(asset: Asset): number | null {
  if (!asset.out_of_service || !asset.oos_since) return null;
  const since = parseDay(asset.oos_since);
  if (!since) return null;
  return Math.max(0, Math.round((todayMidnight().getTime() - since.getTime()) / DAY_MS));
}

export const STATE_COLOR: Record<InspectionState, string> = {
  overdue: "var(--dash-danger)",
  due_soon: "var(--dash-warn)",
  ok: "var(--dash-muted)",
  unknown: "var(--dash-faint)",
};
