import type { PartLocation } from "./contract";

// Formatting + total derivation shared by the parts table and the detail modal.
// deriveTotals mirrors derive_totals in backend/railio/parts_repo.py (same
// rounding) so the number the user watches while typing is the number we store.

export function fmtMoney(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function fmtLocations(locs: PartLocation[]): string {
  if (!locs || locs.length === 0) return "";
  if (locs.length === 1) return `${locs[0].location} · ${locs[0].qty}`;
  return `${locs.length} locations`;
}

export function locTitle(locs: PartLocation[]): string {
  if (!locs || locs.length === 0) return "";
  return locs.map((l) => `${l.location}: ${l.qty}`).join("\n");
}

function round(n: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

export type PartTotals = {
  qty: number;
  avgCost: number | null;
  value: number | null;
};

/**
 * A part's item-level numbers. With locations all three are derived and the
 * passed qty/avgCost are ignored — the ledger carries a different avg cost per
 * location, so the item avg is the weighted average (total value / total qty).
 * Without locations they're author-owned and only value is derived.
 */
export function deriveTotals(
  locations: PartLocation[] | null | undefined,
  qtyOnHand: number,
  avgCost: number | null,
): PartTotals {
  if (locations && locations.length > 0) {
    const qty = Math.round(
      locations.reduce((a, l) => a + (Number(l.qty) || 0), 0),
    );
    const vals = locations
      .filter((l) => l.avg_cost != null)
      .map((l) => (Number(l.qty) || 0) * Number(l.avg_cost));
    const value = vals.length ? round(vals.reduce((a, b) => a + b, 0), 2) : null;
    const avg = value != null && qty > 0 ? round(value / qty, 4) : null;
    return { qty, avgCost: avg, value };
  }
  const value = avgCost != null ? round(qtyOnHand * avgCost, 2) : null;
  return { qty: qtyOnHand, avgCost, value };
}
