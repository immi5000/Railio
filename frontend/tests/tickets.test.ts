import type { Ticket, TicketStatus } from "@contract";
import { describe, expect, it } from "vitest";

import { visibleToRole, visibleTickets } from "@/lib/tickets";

// Every status in the contract. Written out rather than derived, so adding one
// to contract.ts fails here until it's deliberately handled.
const ALL_STATUSES: TicketStatus[] = [
  "AWAITING_HANDOFF",
  "AWAITING_TECH",
  "IN_PROGRESS",
  "AWAITING_REVIEW",
  "CLOSED",
];

function ticket(status: TicketStatus): Ticket {
  return {
    id: 1,
    short_id: `T-${status}`,
    title: null,
    org_id: 1,
    asset: { id: 1, unit_model: "ES44DC" } as Ticket["asset"],
    status,
    severity: "minor",
    opened_at: "2026-01-01T00:00:00Z",
    initial_error_codes: null,
    initial_symptoms: null,
    fault_dump_raw: null,
    fault_dump_parsed: null,
    pre_arrival_summary: null,
    closed_at: null,
    is_pristine: null,
  };
}

describe("visibleToRole", () => {
  it("hides an un-handed-off ticket from the tech", () => {
    expect(visibleToRole(ticket("AWAITING_HANDOFF"), "tech")).toBe(false);
  });

  it("shows an un-handed-off ticket to the dispatcher who still holds it", () => {
    expect(visibleToRole(ticket("AWAITING_HANDOFF"), "dispatcher")).toBe(true);
  });

  it.each(ALL_STATUSES.filter((s) => s !== "AWAITING_HANDOFF"))(
    "shows %s to the tech once it has been handed off",
    (status) => {
      expect(visibleToRole(ticket(status), "tech")).toBe(true);
    },
  );

  it.each(ALL_STATUSES)("shows %s to the dispatcher", (status) => {
    expect(visibleToRole(ticket(status), "dispatcher")).toBe(true);
  });
});

describe("visibleTickets", () => {
  const all = ALL_STATUSES.map(ticket);

  it("drops only the handoff ticket for a tech", () => {
    const seen = visibleTickets(all, "tech").map((t) => t.status);
    expect(seen).not.toContain("AWAITING_HANDOFF");
    expect(seen).toHaveLength(ALL_STATUSES.length - 1);
  });

  it("passes everything through for dispatch", () => {
    expect(visibleTickets(all, "dispatcher")).toHaveLength(ALL_STATUSES.length);
  });

  // The bug this guards: a tech's board defaults to the "open" filter
  // (status !== CLOSED), which on its own happily includes AWAITING_HANDOFF.
  it("keeps handoff tickets out of the tech's open board", () => {
    const open = visibleTickets(all, "tech").filter((t) => t.status !== "CLOSED");
    expect(open.map((t) => t.status)).toEqual([
      "AWAITING_TECH",
      "IN_PROGRESS",
      "AWAITING_REVIEW",
    ]);
  });
});
