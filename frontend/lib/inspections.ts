// Derived FRA periodic-inspection status. Single home for the due/overdue logic
// consumed by FleetAdmin, the dashboard fleet table, and RepairContext — so the
// rule (next due = last + interval) lives in exactly one place.
//
// The contract module is type-only (never bundled — it lives outside the Next.js
// root and is consumed via `import type`), so this runtime constant lives here.
// Keep in sync with INSPECTION_INTERVALS in backend/railio/contract.py.
import type { Asset } from "@/lib/contract";

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
  nextDue: string | null; // YYYY-MM-DD
  state: InspectionState;
};

const DUE_SOON_DAYS = 14;
const DAY_MS = 86_400_000;

function parseDay(d: string | null): Date | null {
  if (!d) return null;
  const dt = new Date(`${d.slice(0, 10)}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function todayMidnight(): Date {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
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
      };
    }
    const due = new Date(lastDt.getTime() + interval.days * DAY_MS);
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
