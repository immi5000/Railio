"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { listTickets, listAssets, getMe, listOrgMembers } from "@/lib/api";
import type { TicketStatus, Asset, Ticket } from "@/lib/contract";
import { mostUrgent, oosDays, STATE_COLOR } from "@/lib/inspections";

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

// Fleet status-dot palette, cycled by row so the table reads like the Figma frame.
const FLEET_DOTS = ["#000000", "#2683eb", "#9a9aa0"];

function unitLabel(asset: Asset): string {
  return `${asset.reporting_mark} ${asset.road_number}`.trim();
}

function faultLine(t: Ticket): string {
  const parsed = t.fault_dump_parsed?.[0]?.code?.trim();
  if (parsed) return parsed;
  const codes = t.initial_error_codes?.trim();
  return codes || "no fault code";
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const DATETIME_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : DATE_FMT.format(d);
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : DATETIME_FMT.format(d);
}

export default function DashboardPage() {
  const [unitFilter, setUnitFilter] = useState<string>("all");

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe, retry: false });
  const { data: tickets = [] } = useQuery({
    queryKey: ["tickets", "dashboard"],
    queryFn: () => listTickets(),
    refetchInterval: 15000,
  });
  const { data: assets = [] } = useQuery({
    queryKey: ["assets", "dashboard"],
    queryFn: listAssets,
    refetchInterval: 30000,
  });
  const { data: members = [] } = useQuery({
    queryKey: ["org-members"],
    queryFn: listOrgMembers,
    retry: false,
  });
  const open = useMemo(() => tickets.filter((t) => t.status !== "CLOSED"), [tickets]);

  // Open-ticket count per asset, for the work-order and fleet row badges.
  const openByAsset = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of open) m.set(t.asset.id, (m.get(t.asset.id) ?? 0) + 1);
    return m;
  }, [open]);

  const units = useMemo(
    () => Array.from(new Set(tickets.map((t) => unitLabel(t.asset)))).sort(),
    [tickets],
  );
  const visibleWorkOrders = useMemo(
    () =>
      unitFilter === "all"
        ? tickets
        : tickets.filter((t) => unitLabel(t.asset) === unitFilter),
    [tickets, unitFilter],
  );

  const alert = open.find((t) => t.severity === "critical") ?? null;
  const criticalCount = open.filter((t) => t.severity === "critical").length;

  // Fleet availability = (total units − units with an OPEN critical ticket) / total.
  // Iterate assets (not the id-set) so `down` can never exceed `total`.
  const criticalAssetIds = useMemo(() => {
    const s = new Set<number>();
    for (const t of open) if (t.severity === "critical") s.add(t.asset.id);
    return s;
  }, [open]);
  const downCount = useMemo(
    () => assets.filter((a) => criticalAssetIds.has(a.id)).length,
    [assets, criticalAssetIds],
  );
  const availLabel = assets.length
    ? `${(((assets.length - downCount) / assets.length) * 100).toFixed(1)}%`
    : "—";

  const firstName = me?.name?.split(/\s+/)[0] || "there";

  // Team roster = real onboarded org members, the signed-in user first. There is
  // no role/shift field on app_users, so the secondary line is the email. The
  // signed-in user is "in" (green); everyone else is "out".
  const people = useMemo(
    () =>
      [...members]
        .sort((a, b) => Number(b.is_self) - Number(a.is_self))
        .map((m) => ({
          name: m.name || m.email,
          role: m.email,
          in: m.is_self,
          me: m.is_self,
        })),
    [members],
  );

  return (
    <div className="dash">
      <div className="dash-inner">
        {/* Greeting */}
        <header>
          <h1 className="dash-greeting-title">
            {greeting()}, {firstName}
          </h1>
          <p className="dash-greeting-sub">
            Your fleet status and open tickets are ready to review.
          </p>
        </header>

        {/* Summary stats */}
        <section className="dash-stats">
          {/* Open tickets */}
          <div className="dash-card dash-stat dash-stat--wo">
            <div className="dash-stat-col">
              <span className="dash-stat-label">Open tickets</span>
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
              <span className="dash-stat-value">{availLabel}</span>
            </div>
            <div className="dash-stat-side">
              <span className="dash-stat-flake" aria-hidden="true">
                <SnowflakeIcon />
              </span>
            </div>
          </div>

          {/* Critical alert */}
          <div className="dash-card dash-stat dash-stat--alert">
            <div className="dash-stat-toprow">
              <span className="dash-alert-badge" data-clear={!alert}>
                {alert ? "CRITICAL" : "ALL CLEAR"}
              </span>
              {alert && (
                <Link href={`/work?ticket=${alert.id}&from=dashboard`} className="dash-link">
                  View <span className="ico-arr" aria-hidden="true" />
                </Link>
              )}
            </div>
            <div>
              <p className="dash-alert-title">
                {alert
                  ? `${criticalCount} unit${criticalCount > 1 ? "s" : ""} need${criticalCount > 1 ? "" : "s"} immediate attention`
                  : "No units need attention"}
              </p>
              <p className="dash-sub" style={{ marginTop: 8 }}>
                {alert
                  ? `${unitLabel(alert.asset)} · ${alert.asset.unit_model} · ${faultLine(alert)}`
                  : "All locomotives are operating normally."}
              </p>
            </div>
          </div>
        </section>

        {/* Tickets */}
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
              <h2 className="dash-section-title">Tickets</h2>
              <p className="dash-section-sub">
                {tickets.length} total · {open.length} open
              </p>
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
              <span className="dash-th">Ticket</span>
              <span className="dash-th">Symptoms / fault</span>
              <span className="dash-th">Severity</span>
              <span className="dash-th dash-hide-sm">Status</span>
              <span className="dash-th dash-hide-sm" style={{ textAlign: "right" }}>
                Opened
              </span>
            </div>

            {visibleWorkOrders.length === 0 && (
              <div className="dash-row dash-wo">
                <span className="dash-sub">No tickets.</span>
              </div>
            )}

            {visibleWorkOrders.map((t) => {
              const openCount = openByAsset.get(t.asset.id) ?? 0;
              const symptom = t.title || t.initial_symptoms || "—";
              return (
                <Link
                  key={t.id}
                  href={`/work?ticket=${t.id}&from=dashboard`}
                  className="dash-row dash-wo dash-row--click"
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className="dash-id">#{t.short_id || t.id}</span>
                    <span className="dash-unit">
                      {unitLabel(t.asset)} · {t.asset.unit_model}
                    </span>
                    {openCount > 0 && (
                      <span className="dash-count" data-on={openCount > 1}>
                        {openCount}
                      </span>
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p className="dash-cell" style={{ margin: 0 }}>
                      {symptom}
                    </p>
                    <p className="dash-sub" style={{ margin: "3px 0 0" }}>
                      {faultLine(t)}
                    </p>
                  </div>
                  <div>
                    <span className={`dash-sev dash-sev-${t.severity}`}>
                      {t.severity.toUpperCase()}
                    </span>
                  </div>
                  <div className="dash-hide-sm">
                    <span className="dash-status">
                      <span
                        className="dash-dot"
                        style={{ background: STATUS_DOT[t.status] }}
                      />
                      {STATUS_LABEL[t.status]}
                    </span>
                  </div>
                  <div className="dash-hide-sm">
                    <span className="dash-sub" style={{ display: "block", textAlign: "right" }}>
                      {fmtDateTime(t.opened_at)}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="dash-foot">
            <span className="dash-sub">
              {open.length} open ticket{open.length === 1 ? "" : "s"}
            </span>
            <Link href="/work" className="dash-link">
              All tickets <span className="ico-arr" aria-hidden="true" />
            </Link>
          </div>
        </section>

        {/* Fleets + Team */}
        <section className="dash-bottom">
          {/* Fleets */}
          <div className="dash-card" style={{ padding: "22px 28px" }}>
            <h2 className="dash-section-title">Fleets</h2>
            <p className="dash-section-sub" style={{ marginBottom: 8 }}>
              {assets.length} locomotive{assets.length === 1 ? "" : "s"}
            </p>

            <div className="dash-table">
              <div className="dash-row dash-fleet dash-row--head">
                <span className="dash-th">Unit</span>
                <span className="dash-th">Model</span>
                <span className="dash-th dash-hide-sm">In service</span>
                <span className="dash-th dash-hide-sm">Next due</span>
                <span className="dash-th dash-hide-sm">Status</span>
                <span className="dash-th" style={{ textAlign: "right" }}>
                  Open
                </span>
              </div>

              {assets.length === 0 && (
                <div className="dash-row dash-fleet">
                  <span className="dash-sub">No locomotives.</span>
                </div>
              )}

              {assets.map((a, i) => {
                const openCount = openByAsset.get(a.id) ?? 0;
                const urgent = mostUrgent(a);
                const down = oosDays(a);
                return (
                  <Link
                    key={a.id}
                    href="/admin/fleet"
                    className="dash-row dash-fleet dash-row--click"
                  >
                    <span className="dash-status" style={{ color: "#000" }}>
                      <span
                        className="dash-dot"
                        style={{ background: FLEET_DOTS[i % FLEET_DOTS.length] }}
                      />
                      <span className="dash-unit">{unitLabel(a)}</span>
                    </span>
                    <span className="dash-data">{a.unit_model}</span>
                    <span className="dash-data dash-hide-sm">{fmtDate(a.in_service_date)}</span>
                    <span
                      className="dash-data dash-hide-sm"
                      style={{ color: STATE_COLOR[urgent.state] }}
                    >
                      {urgent.nextDue
                        ? `${urgent.label}: ${fmtDate(urgent.nextDue)}`
                        : "—"}
                    </span>
                    <span className="dash-data dash-hide-sm">
                      {down !== null ? (
                        <span style={{ color: "var(--dash-danger)" }}>
                          Down {down}d
                        </span>
                      ) : urgent.state === "overdue" ? (
                        <span style={{ color: "var(--dash-danger)" }}>Overdue</span>
                      ) : urgent.state === "due_soon" ? (
                        <span style={{ color: "var(--dash-warn)" }}>Due soon</span>
                      ) : (
                        "In service"
                      )}
                    </span>
                    <span style={{ textAlign: "right" }}>
                      <span className="dash-count" data-on={openCount > 1}>
                        {openCount}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>

            <div className="dash-foot">
              <span className="dash-sub">
                Fleet availability {availLabel}
              </span>
              <Link href="/admin/fleet" className="dash-link">
                All fleets <span className="ico-arr" aria-hidden="true" />
              </Link>
            </div>
          </div>

          {/* Team & contacts */}
          <div className="dash-card" style={{ padding: "20px 28px" }}>
            <h2 className="dash-section-title">Team &amp; contacts</h2>
            <p className="dash-section-sub" style={{ marginBottom: 18 }}>
              {people.length} {people.length === 1 ? "person" : "people"}
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
                const variant = p.me ? "me" : "default";
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
              <span className="dash-sub">None yet</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
