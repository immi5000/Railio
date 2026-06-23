"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { listTickets, getMe } from "@/lib/api";
import type { TicketStatus, Severity } from "@/lib/contract";

// Status dot color, mirroring the Figma legend:
// awaiting tech = amber, in progress = blue, awaiting review = gray, closed = green.
const STATUS_DOT: Record<TicketStatus, string> = {
  AWAITING_TECH: "#e0a200",
  IN_PROGRESS: "#2683eb",
  AWAITING_REVIEW: "#9a9aa0",
  CLOSED: "#5fb85f",
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  AWAITING_TECH: "Awaiting tech",
  IN_PROGRESS: "In progress",
  AWAITING_REVIEW: "Awaiting review",
  CLOSED: "Closed",
};

function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function initials(name: string | null | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "—";
}

// Faint decorative snowflake in the fleet-availability card (matches Figma).
function SnowflakeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M12 2v20M2 12h20M4.5 4.5l15 15M19.5 4.5l-15 15" />
      <path d="M12 5l-2.2-2.2M12 5l2.2-2.2M12 19l-2.2 2.2M12 19l2.2 2.2M5 12l-2.2-2.2M5 12l-2.2 2.2M19 12l2.2-2.2M19 12l2.2 2.2" />
    </svg>
  );
}

// The technician roster has no backend yet, so it is derived from the known
// shift crew. The signed-in dispatcher is prepended from /api/me.
const CREW = [
  { name: "Bob", role: "Technician · 1st shift", in: true },
  { name: "John", role: "Technician · 2nd shift", in: false },
  { name: "Akshay", role: "Technician · 3rd shift", in: false },
  { name: "Devan", role: "Technician · swing", in: true },
];

const SUPPLIERS = [
  { name: "GE Transportation", kind: "Parts supplier" },
  { name: "Wabtec", kind: "Brake systems" },
  { name: "SKF", kind: "Bearings" },
];

// Mock data lifted directly from the Figma frame (node 91:862) so the Work
// orders + Fleets tables show the intended UI regardless of the live backend.
type MockWorkOrder = {
  id: string;
  mark: string;
  model: string;
  openCount: number;
  symptom: string;
  fault: string;
  severity: Severity;
  status: TicketStatus;
  opened: string;
};

const MOCK_WORK_ORDERS: MockWorkOrder[] = [
  {
    id: "#12",
    mark: "BNSF 7670",
    model: "ES44DC",
    openCount: 2,
    symptom: "random test",
    fault: "fault TEST",
    severity: "critical",
    status: "AWAITING_TECH",
    opened: "Jun 16, 5:39 PM",
  },
  {
    id: "#9",
    mark: "BNSF 7670",
    model: "ES44DC",
    openCount: 2,
    symptom: "Headlight LED module flicker",
    fault: "no fault code",
    severity: "minor",
    status: "CLOSED",
    opened: "Jun 10, 2:14 PM",
  },
  {
    id: "#11",
    mark: "BNSF 7695",
    model: "ES44DC",
    openCount: 1,
    symptom: "Notch 8 derate",
    fault: "fault 7311",
    severity: "major",
    status: "IN_PROGRESS",
    opened: "Jun 14, 9:02 AM",
  },
  {
    id: "#10",
    mark: "BNSF 7720",
    model: "ES44DC",
    openCount: 1,
    symptom: "Cab HVAC blower intermit...",
    fault: "no fault code",
    severity: "minor",
    status: "AWAITING_REVIEW",
    opened: "Jun 12, 4:48 PM",
  },
];

type MockFleet = {
  unit: string;
  dot: string;
  model: string;
  inService: string;
  lastInsp: string;
  open: number;
};

const MOCK_FLEETS: MockFleet[] = [
  { unit: "BNSF 7670", dot: "#000000", model: "ES44DC", inService: "Aug 15, 2006", lastInsp: "Apr 15, 2026", open: 2 },
  { unit: "BNSF 7695", dot: "#2683eb", model: "ES44DC", inService: "Nov 2, 2006", lastInsp: "Apr 22, 2026", open: 1 },
  { unit: "BNSF 7720", dot: "#9a9aa0", model: "ES44DC", inService: "Mar 9, 2007", lastInsp: "Apr 10, 2026", open: 1 },
];

export default function DashboardPage() {
  const [unitFilter, setUnitFilter] = useState<string>("all");

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe, retry: false });
  const { data: tickets = [] } = useQuery({
    queryKey: ["tickets", "dashboard"],
    queryFn: () => listTickets(),
    refetchInterval: 15000,
  });
  const open = useMemo(() => tickets.filter((t) => t.status !== "CLOSED"), [tickets]);

  // Work orders + Fleets render from Figma mock data (see MOCK_* above).
  const units = useMemo(
    () => Array.from(new Set(MOCK_WORK_ORDERS.map((w) => w.mark))).sort(),
    [],
  );
  const visibleWorkOrders = useMemo(
    () =>
      unitFilter === "all"
        ? MOCK_WORK_ORDERS
        : MOCK_WORK_ORDERS.filter((w) => w.mark === unitFilter),
    [unitFilter],
  );

  // Fleet-availability + critical-alert cards read from the Figma mock so they
  // match the design (and stay consistent with the mocked work orders/fleets).
  const mockAvailability = "98.2%";
  const mockTrend = "↓ 1.8%";
  const mockOpenWorkOrders = MOCK_WORK_ORDERS.filter((w) => w.status !== "CLOSED");
  const mockAlert =
    mockOpenWorkOrders.find((w) => w.severity === "critical") ?? null;
  const mockCriticalCount = mockOpenWorkOrders.filter(
    (w) => w.severity === "critical",
  ).length;

  const firstName = me?.name?.split(/\s+/)[0] || "there";

  const people = [
    me?.name
      ? { name: me.name, role: "Dispatcher", in: true, me: true }
      : { name: "You", role: "Dispatcher", in: true, me: true },
    ...CREW.map((c) => ({ ...c, me: false })),
  ];

  return (
    <div className="dash">
      <div className="dash-inner">
        {/* Greeting */}
        <header>
          <h1 className="dash-greeting-title">
            {greeting()}, {firstName}
          </h1>
          <p className="dash-greeting-sub">
            Your fleet status and open work orders are ready to review.
          </p>
        </header>

        {/* Summary stats */}
        <section className="dash-stats">
          {/* Open work orders */}
          <div className="dash-card dash-stat dash-stat--wo">
            <div className="dash-stat-col">
              <span className="dash-stat-label">Open work orders</span>
              <span className="dash-stat-value">
                {String(open.length).padStart(2, "0")}
              </span>
            </div>
            <span className="dash-stat-block" />
          </div>

          {/* Fleet availability */}
          <div className="dash-card dash-stat dash-stat--avail">
            <div className="dash-stat-col">
              <span className="dash-stat-label">Fleet availability</span>
              <span className="dash-stat-value">{mockAvailability}</span>
            </div>
            <div className="dash-stat-side">
              <span className="dash-stat-flake" aria-hidden="true">
                <SnowflakeIcon />
              </span>
              <span className="dash-trend">{mockTrend}</span>
            </div>
          </div>

          {/* Critical alert */}
          <div className="dash-card dash-stat dash-stat--alert">
            <div className="dash-stat-toprow">
              <span className="dash-alert-badge" data-clear={!mockAlert}>
                {mockAlert ? "CRITICAL" : "ALL CLEAR"}
              </span>
              {mockAlert && (
                <Link href="/work" className="dash-link">
                  View →
                </Link>
              )}
            </div>
            <div>
              <p className="dash-alert-title">
                {mockAlert
                  ? `${mockCriticalCount} unit${mockCriticalCount > 1 ? "s" : ""} need${mockCriticalCount > 1 ? "" : "s"} immediate attention`
                  : "No units need attention"}
              </p>
              <p className="dash-sub" style={{ marginTop: 8 }}>
                {mockAlert
                  ? `${mockAlert.mark} · ${mockAlert.model} · ${mockAlert.fault}`
                  : "All locomotives are operating normally."}
              </p>
            </div>
          </div>
        </section>

        {/* Work orders */}
        <section className="dash-card" style={{ padding: "22px 28px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 16,
              marginBottom: 8,
            }}
          >
            <div>
              <h2 className="dash-section-title">Work orders</h2>
              <p className="dash-section-sub">4 total · 3 open</p>
            </div>
            <select
              className="dash-filter"
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              aria-label="Filter by locomotive"
            >
              <option value="all">Locomotive</option>
              {units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          <div className="dash-table">
            <div className="dash-row dash-wo dash-row--head">
              <span className="dash-th">Work order</span>
              <span className="dash-th">Symptoms / fault</span>
              <span className="dash-th">Severity</span>
              <span className="dash-th dash-hide-sm">Status</span>
              <span className="dash-th dash-hide-sm" style={{ textAlign: "right" }}>
                Opened
              </span>
            </div>

            {visibleWorkOrders.length === 0 && (
              <div className="dash-row dash-wo">
                <span className="dash-sub">No work orders.</span>
              </div>
            )}

            {visibleWorkOrders.map((w) => (
              <Link key={w.id} href="/work" className="dash-row dash-wo dash-row--click">
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className="dash-id">{w.id}</span>
                  <span className="dash-unit">
                    {w.mark} · {w.model}
                  </span>
                  {w.openCount > 0 && (
                    <span className="dash-count" data-on={w.openCount > 1}>
                      {w.openCount}
                    </span>
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <p className="dash-cell" style={{ margin: 0 }}>
                    {w.symptom}
                  </p>
                  <p className="dash-sub" style={{ margin: "3px 0 0" }}>
                    {w.fault}
                  </p>
                </div>
                <div>
                  <span className={`dash-sev dash-sev-${w.severity}`}>
                    {w.severity.toUpperCase()}
                  </span>
                </div>
                <div className="dash-hide-sm">
                  <span className="dash-status">
                    <span
                      className="dash-dot"
                      style={{ background: STATUS_DOT[w.status] }}
                    />
                    {STATUS_LABEL[w.status]}
                  </span>
                </div>
                <div className="dash-hide-sm">
                  <span className="dash-sub" style={{ display: "block", textAlign: "right" }}>
                    {w.opened}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Fleets + Team */}
        <section className="dash-bottom">
          {/* Fleets */}
          <div className="dash-card" style={{ padding: "22px 28px" }}>
            <h2 className="dash-section-title">Fleets</h2>
            <p className="dash-section-sub" style={{ marginBottom: 8 }}>
              3 locomotives · ES44DC fleet · GEVO 12-cyl
            </p>

            <div className="dash-table">
              <div className="dash-row dash-fleet dash-row--head">
                <span className="dash-th">Unit</span>
                <span className="dash-th">Model</span>
                <span className="dash-th dash-hide-sm">In service</span>
                <span className="dash-th dash-hide-sm">Last insp.</span>
                <span className="dash-th" style={{ textAlign: "right" }}>
                  Open
                </span>
              </div>

              {MOCK_FLEETS.map((f) => (
                <Link
                  key={f.unit}
                  href="/admin/fleet"
                  className="dash-row dash-fleet dash-row--click"
                >
                  <span className="dash-status" style={{ color: "#000" }}>
                    <span className="dash-dot" style={{ background: f.dot }} />
                    <span className="dash-unit">{f.unit}</span>
                  </span>
                  <span className="dash-data">{f.model}</span>
                  <span className="dash-data dash-hide-sm">{f.inService}</span>
                  <span className="dash-data dash-hide-sm">{f.lastInsp}</span>
                  <span style={{ textAlign: "right" }}>
                    <span className="dash-count" data-on={f.open > 1}>
                      {f.open}
                    </span>
                  </span>
                </Link>
              ))}
            </div>

            <div className="dash-foot">
              <span className="dash-sub">
                Fleet availability 98.2% · next PM due Apr 28, 2026
              </span>
              <Link href="/admin/fleet" className="dash-link">
                All fleets →
              </Link>
            </div>
          </div>

          {/* Team & contacts */}
          <div className="dash-card" style={{ padding: "20px 28px" }}>
            <h2 className="dash-section-title">Team &amp; contacts</h2>
            <p className="dash-section-sub" style={{ marginBottom: 18 }}>
              {people.length} people · {SUPPLIERS.length} suppliers
            </p>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 13,
                marginBottom: 20,
              }}
            >
              {people.map((p, i) => {
                const variant = p.me ? "me" : i === 1 ? "accent" : "default";
                return (
                  <div className="dash-person" key={`${p.name}-${i}`}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                      <span className="dash-avatar" data-variant={variant}>
                        {initials(p.name)}
                      </span>
                      <div className="dash-person-text">
                        <span className="dash-person-name">{p.name}</span>
                        <span className="dash-person-role">{p.role}</span>
                      </div>
                    </div>
                    <span className="dash-person-status">
                      <span className="dash-sub">{p.in ? "in" : "out"}</span>
                      <span
                        className="dash-dot"
                        style={{ background: p.in ? "#5fb85f" : "#9a9aa0" }}
                      />
                    </span>
                  </div>
                );
              })}
            </div>

            <div
              className="dash-foot"
              style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}
            >
              <span className="dash-supplier-label">SUPPLIER CONTACTS</span>
              {SUPPLIERS.map((s) => (
                <div
                  key={s.name}
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <span
                    className="dash-mono"
                    style={{ fontWeight: 700, fontSize: 13, color: "#000" }}
                  >
                    {s.name}
                  </span>
                  <span className="dash-sub" style={{ textAlign: "right" }}>
                    {s.kind}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
