import type { TicketStatus } from "@contract";
import { describe, expect, it } from "vitest";

import { formatDate, formatDateOnly, severityClass, statusLabel, statusPillClass } from "@/lib/format";

// Every status in the contract. Written out rather than derived, so adding one
// to contract.ts fails here until it's deliberately handled in the UI.
const ALL_STATUSES: TicketStatus[] = [
  "AWAITING_HANDOFF",
  "AWAITING_TECH",
  "IN_PROGRESS",
  "AWAITING_REVIEW",
  "CLOSED",
];

describe("statusLabel", () => {
  it.each(ALL_STATUSES)("gives %s a human label", (status) => {
    const label = statusLabel(status);
    expect(label).toBeTruthy();
    expect(label).not.toContain("_");
  });

  it("labels the pre-handoff state", () => {
    expect(statusLabel("AWAITING_HANDOFF")).toBe("Awaiting handoff");
  });

  it("gives every status a distinct label", () => {
    const labels = ALL_STATUSES.map(statusLabel);
    expect(new Set(labels).size).toBe(ALL_STATUSES.length);
  });
});

describe("statusPillClass", () => {
  it.each(ALL_STATUSES)("gives %s a pill class", (status) => {
    expect(statusPillClass(status)).toMatch(/^pill/);
  });
});

describe("severityClass", () => {
  it.each(["minor", "major", "critical"] as const)("maps %s", (s) => {
    expect(severityClass(s)).toBe(`pill sev-${s}`);
  });
});

describe("formatDate", () => {
  it("renders an em dash for nothing", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
  });

  it("passes unparseable input straight through rather than showing NaN", () => {
    expect(formatDate("not a date")).toBe("not a date");
    expect(formatDateOnly("nonsense")).toBe("nonsense");
  });

  it("formats a real ISO timestamp", () => {
    expect(formatDate("2026-05-22T17:38:02.642Z")).toMatch(/May/);
    expect(formatDateOnly("2026-05-22T17:38:02.642Z")).toMatch(/2026/);
  });
});
