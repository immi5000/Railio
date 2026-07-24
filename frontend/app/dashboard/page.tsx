"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { listTickets, listAssets, getMe, listOrgMembers } from "@/lib/api";
import type { TicketStatus, Asset, Ticket, Severity } from "@/lib/contract";
import { mostUrgent, oosDays, STATE_COLOR } from "@/lib/inspections";
import { visibleTickets } from "@/lib/tickets";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { useRole } from "@/components/RoleProvider";

// Status dot color, mirroring the Figma legend: awaiting handoff = muted grey,
// awaiting tech = amber, in progress = blue, awaiting review = gray, closed = green.
const STATUS_DOT: Record<TicketStatus, string> = {
  AWAITING_HANDOFF: "#7a7a7e",
  AWAITING_TECH: "#e0a200",
  IN_PROGRESS: "#2683eb",
  AWAITING_REVIEW: "#9a9aa0",
  CLOSED: "#5fb85f",
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  AWAITING_HANDOFF: "Awaiting handoff",
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

// Single four-point AI sparkle, centered and filled with our --dash-link blue.
// Marks the Copilot quick-link.
function SparkleIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {/* Arm edges bow outward (cubic curves) for softer, rounded edges rather
          than dead-straight knife points. */}
      <path
        d="M12 2C12.6 7.4 13.6 9.8 16.1 10.9C17.4 11.5 18.9 11.7 22 12C18.9 12.3 17.4 12.5 16.1 13.1C13.6 14.2 12.6 16.6 12 22C11.4 16.6 10.4 14.2 7.9 13.1C6.6 12.5 5.1 12.3 2 12C5.1 11.7 6.6 11.5 7.9 10.9C10.4 9.8 11.4 7.4 12 2Z"
        style={{ fill: "var(--dash-link)" }}
      />
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

// Priority rank for sorting — lower number sorts first (most urgent on top).
const SEV_RANK: Record<Severity, number> = { critical: 0, major: 1, minor: 2 };

type SortMode = "priority" | "locomotive";

export default function DashboardPage() {
  const { role } = useRole();
  const router = useRouter();
  const [sortMode, setSortMode] = useState<SortMode>("priority");
  const [unitFilter, setUnitFilter] = useState<string>("all");
  // Copilot quick-ask: what the user has typed into the dashboard card. When
  // present, the card's CTA flips from "Start chat" to "Ask Railio" and carries
  // the text into the chat page (auto-sent on submit, prefilled on a bare click).
  const [copilotAsk, setCopilotAsk] = useState("");

  function openCopilot(send: boolean) {
    const q = copilotAsk.trim();
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (send && q) qs.set("send", "1");
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    router.push(`/copilot${suffix}`);
  }

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe, retry: false });
  const { data: tickets = [], isLoading: ticketsLoading } = useQuery({
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
  // Role-scoped first: a tech's dashboard must not count or list tickets the
  // dispatcher hasn't handed off yet. Every derived view below reads off `open`.
  const open = useMemo(
    () =>
      visibleTickets(tickets, role).filter((t) => t.status !== "CLOSED"),
    [tickets, role],
  );

  // Open-ticket count per asset, for the work-order and fleet row badges.
  const openByAsset = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of open) m.set(t.asset.id, (m.get(t.asset.id) ?? 0) + 1);
    return m;
  }, [open]);

  const units = useMemo(
    () => Array.from(new Set(open.map((t) => unitLabel(t.asset)))).sort(),
    [open],
  );
  const visibleWorkOrders = useMemo(() => {
    // Closed tickets drop off the dashboard entirely — they live on the
    // All-tickets page. The dashboard only ever shows the open board.
    const filtered =
      unitFilter === "all"
        ? open
        : open.filter((t) => unitLabel(t.asset) === unitFilter);

    // Sort by severity (critical → major → minor), most recent first as a
    // tie-break; or group alphabetically by locomotive unit.
    const sorted = [...filtered];
    if (sortMode === "locomotive") {
      sorted.sort(
        (a, b) =>
          unitLabel(a.asset).localeCompare(unitLabel(b.asset)) ||
          SEV_RANK[a.severity] - SEV_RANK[b.severity],
      );
    } else {
      sorted.sort(
        (a, b) =>
          SEV_RANK[a.severity] - SEV_RANK[b.severity] ||
          new Date(b.opened_at ?? 0).getTime() -
            new Date(a.opened_at ?? 0).getTime(),
      );
    }
    return sorted;
  }, [open, unitFilter, sortMode]);

  // The Open-tickets block reflects the most severe open ticket:
  // black = critical, yellow = major, grey = minor (and the none-open case).
  const topSeverity: Severity | null = open.some((t) => t.severity === "critical")
    ? "critical"
    : open.some((t) => t.severity === "major")
      ? "major"
      : open.some((t) => t.severity === "minor")
        ? "minor"
        : null;
  const SEV_BLOCK: Record<Severity, string> = {
    critical: "#000",
    major: "#fff246",
    minor: "#d9dadd",
  };
  const blockColor = topSeverity ? SEV_BLOCK[topSeverity] : "#d9dadd";

  // Fleet availability = (total units − down units) / total. A unit is "down"
  // if it is marked out-of-service OR has an OPEN critical/major ticket.
  // Iterate assets (not the id-set) so `down` can never exceed `total`.
  const downAssetIds = useMemo(() => {
    const s = new Set<number>();
    for (const t of open) {
      if (t.severity === "critical" || t.severity === "major") s.add(t.asset.id);
    }
    return s;
  }, [open]);
  const downCount = useMemo(
    () => assets.filter((a) => a.out_of_service || downAssetIds.has(a.id)).length,
    [assets, downAssetIds],
  );
  // Don't show a confident number until both feeds have loaded — otherwise the
  // brief assets-loaded-but-tickets-pending window renders a false 100.0%.
  const availLabel =
    ticketsLoading || !assets.length
      ? "—"
      : `${(((assets.length - downCount) / assets.length) * 100).toFixed(1)}%`;

  const firstName = me?.name?.split(/\s+/)[0] || "there";

  // Live descriptor under the org name in the company switcher — total units and
  // open-ticket load, both derived from the same feeds this page already reads.
  const companyHint = useMemo(() => {
    if (!assets.length) return "No units yet";
    const unitPart = `${assets.length} unit${assets.length === 1 ? "" : "s"}`;
    const openPart =
      open.length === 0 ? "all clear" : `${open.length} open`;
    return `${unitPart} · ${openPart}`;
  }, [assets.length, open.length]);

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
          {/* Open tickets — links to the all-tickets board pre-filtered to Open. */}
          <Link
            href="/work?status=open&from=dashboard"
            className="dash-card dash-stat dash-stat--wo dash-stat--link"
          >
            <div className="dash-stat-col">
              <span className="dash-stat-label">Open tickets</span>
              <span className="dash-stat-value">
                {String(open.length).padStart(2, "0")}
              </span>
            </div>
            <span className="dash-stat-block" style={{ background: blockColor }} />
          </Link>

          {/* Railio Copilot — quick link into the ticketless AI chat. Clicking
              anywhere on the card opens the chat (carrying any typed text);
              typing and submitting the box sends that first message straight
              into the conversation. */}
          <div
            role="button"
            tabIndex={0}
            className="dash-card dash-stat dash-stat--copilot dash-stat--link"
            onClick={() => openCopilot(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openCopilot(false);
              }
            }}
          >
            <div className="dash-copilot-head">
              <div className="dash-copilot-heading">
                <span className="dash-stat-label">Railio Copilot</span>
                <span className="dash-company-hint">Ask about units, parts &amp; more</span>
              </div>
              <span className="dash-stat-flake" aria-hidden="true">
                <SparkleIcon />
              </span>
            </div>
            {/* Input + CTA share one row so the button aligns with the box.
                Stop clicks/keys inside from bubbling to the card's navigate-on-
                click; Enter submits (auto-send) instead. */}
            <form
              className="dash-copilot-form"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                openCopilot(true);
              }}
            >
              <input
                className="dash-copilot-input"
                type="text"
                value={copilotAsk}
                onChange={(e) => setCopilotAsk(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Ask Railio anything…"
                aria-label="Ask Railio"
              />
              <button
                type="button"
                className="dash-link dash-copilot-cta"
                data-active={copilotAsk.trim().length > 0}
                onClick={(e) => {
                  e.stopPropagation();
                  openCopilot(copilotAsk.trim().length > 0);
                }}
              >
                {copilotAsk.trim() ? "Ask Railio" : "Start chat"}{" "}
                <span className="ico-arr" aria-hidden="true" />
              </button>
            </form>
          </div>

          {/* Active client company — the rail operator this crew is maintaining
              right now. A contractor can switch between the companies they service. */}
          <CompanySwitcher orgName={me?.org?.name} hint={companyHint} />
        </section>

        {/* Tickets */}
        <section className="dash-card" style={{ padding: "22px 28px" }}>
          <div className="dash-tickets-head">
            <div>
              <h2 className="dash-section-title">Tickets</h2>
            </div>
            <div className="dash-tickets-controls">
              <select
                className="dash-filter"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                aria-label="Sort tickets"
              >
                <option value="priority">Priority</option>
                <option value="locomotive">Locomotive</option>
              </select>
              <select
                className="dash-filter"
                value={unitFilter}
                onChange={(e) => setUnitFilter(e.target.value)}
                aria-label="Filter by locomotive"
              >
                <option value="all">All locomotives</option>
                {units.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
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

            {ticketsLoading && (
              <div className="dash-row dash-wo">
                <span className="dash-sub">Loading tickets…</span>
              </div>
            )}

            {!ticketsLoading && visibleWorkOrders.length === 0 && (
              <div className="dash-row dash-wo">
                <span className="dash-sub">No tickets.</span>
              </div>
            )}

            {visibleWorkOrders.map((t) => {
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
                  <div className="dash-collapse-sm dash-wo-status">
                    <span className="dash-status">
                      <span
                        className="dash-dot"
                        style={{ background: STATUS_DOT[t.status] }}
                      />
                      {STATUS_LABEL[t.status]}
                    </span>
                  </div>
                  <div className="dash-collapse-sm dash-wo-opened">
                    <span className="dash-sub dash-opened-val">
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
                    <span className="dash-data" data-label="Model">{a.unit_model}</span>
                    <span
                      className="dash-data dash-collapse-sm"
                      data-label="Next due"
                      style={{ color: STATE_COLOR[urgent.state] }}
                    >
                      {urgent.nextDue
                        ? `${urgent.label}: ${fmtDate(urgent.nextDue)}`
                        : "—"}
                    </span>
                    <span className="dash-data dash-collapse-sm" data-label="Status">
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
