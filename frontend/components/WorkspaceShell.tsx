"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import Link from "next/link";
import { getTicket, listTickets, patchTicket } from "@/lib/api";
import { statusLabel } from "@/lib/format";
import { useRole } from "@/components/RoleProvider";
import type { Role } from "@/lib/role";
import type { Ticket, TicketStatus } from "@/lib/contract";

// Figma status pill: white pill with a status-colored dot.
function statusDotColor(status: TicketStatus): string {
  switch (status) {
    case "AWAITING_TECH":
      return "#efc000";
    case "IN_PROGRESS":
      return "#2683eb";
    case "AWAITING_REVIEW":
      return "#8a6def";
    case "CLOSED":
      return "#8dc572";
  }
}

// Mirrors the dashboard work-order table palette/labels so the all-tickets
// page reads identically to the dashboard "Tickets" section.
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

const DATETIME_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : DATETIME_FMT.format(d);
}

function unitLabel(asset: Ticket["asset"]): string {
  return `${asset.reporting_mark} ${asset.road_number}`.trim();
}

function faultLine(t: Ticket): string {
  const parsed = t.fault_dump_parsed?.[0]?.code?.trim();
  if (parsed) return parsed;
  const codes = t.initial_error_codes?.trim();
  return codes || "no fault code";
}

import { ChatPane } from "./ChatPane";
import { RepairContext } from "./RepairContext";
import { IntakeContext } from "./IntakeContext";

/**
 * Work-order page (Figma redesign): with no ticket selected it shows the full
 * ticket list — the same dashboard-styled table as the dashboard "Tickets"
 * section, now as the whole page. Selecting a ticket swaps in the Copilot chat
 * card + context cards, with a context-aware back button ("Dashboard" or "All
 * tickets") replacing the old off-canvas drawer. Role CTAs (start / wrap-up /
 * hand off) live in the header; tech/dispatcher mode is switched from the
 * profile menu in the top nav.
 */
export function WorkspaceShell() {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const selectedId = params.get("ticket") || null;
  // Where the user came from, so the back button points home. Dashboard links
  // pass from=dashboard; the all-tickets list passes from=tickets (default).
  const from = params.get("from") === "dashboard" ? "dashboard" : "tickets";

  const { role } = useRole();

  // On phones the body shows one panel at a time; always land on the chat.
  const [mobileView, setMobileView] = useState<"chat" | "details">("chat");

  const { data, isLoading, error } = useQuery({
    queryKey: ["tickets", "workspace"],
    queryFn: () => listTickets(),
    refetchInterval: 8000,
  });

  const { data: ticket } = useQuery({
    queryKey: ["ticket", selectedId],
    queryFn: () => getTicket(selectedId as string),
    enabled: selectedId != null,
  });

  // Tech sees only actionable tickets; dispatcher sees the whole board.
  const filter = role === "tech" ? ["AWAITING_TECH", "IN_PROGRESS"] : null;
  const tickets: Ticket[] = (data || []).filter((t) =>
    filter ? filter.includes(t.status) : true,
  );

  const isDispatch = role === "dispatcher";

  // Open-ticket count per asset, for the all-tickets row badges.
  const openByAsset = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of tickets) {
      if (t.status !== "CLOSED")
        m.set(t.asset.id, (m.get(t.asset.id) ?? 0) + 1);
    }
    return m;
  }, [tickets]);
  const openCount = tickets.filter((t) => t.status !== "CLOSED").length;

  function select(shortId: string | null) {
    router.push(shortId == null ? "/work" : `/work?ticket=${shortId}&from=tickets`);
  }

  function invalidateTicket() {
    qc.invalidateQueries({ queryKey: ["ticket", selectedId] });
    qc.invalidateQueries({ queryKey: ["tickets"] });
  }

  const startMut = useMutation({
    mutationFn: () => patchTicket(selectedId as string, { status: "IN_PROGRESS" }),
    onSuccess: invalidateTicket,
  });
  const handoffMut = useMutation({
    mutationFn: () => patchTicket(selectedId as string, { status: "AWAITING_TECH" }),
    onSuccess: invalidateTicket,
  });

  // No ticket selected: the all-tickets board, with a page eyebrow + title to
  // match the Knowledge and Fleet pages.
  if (selectedId == null) {
    return (
      <div className="dash">
        <div className="dash-inner" style={{ paddingBottom: 64, gap: 0 }}>
          <span className="sect-eyebrow">Tickets</span>
          <h1 className="h2" style={{ marginTop: 12, marginBottom: 24 }}>
            All tickets
          </h1>

          <TicketList
            role={role}
            tickets={tickets}
            isLoading={isLoading}
            error={!!error}
            openCount={openCount}
            openByAsset={openByAsset}
            onSelect={select}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="work">
      <div className="work-inner">
        <WorkHeader
          ticket={ticket}
          role={role}
          back={
            from === "dashboard"
              ? { href: "/dashboard", label: "Dashboard" }
              : { href: "/work", label: "All tickets" }
          }
          onStart={() => startMut.mutate()}
          starting={startMut.isPending}
          onHandoff={() => handoffMut.mutate()}
          handingOff={handoffMut.isPending}
          onWrapUp={() =>
            router.push(`/tech/ticket/${selectedId}/wrap-up`)
          }
        />

        <div className="work-tabs" role="tablist">
          <button
            type="button"
            className="work-tab"
            data-active={mobileView === "chat"}
            aria-selected={mobileView === "chat"}
            onClick={() => setMobileView("chat")}
          >
            Chat
          </button>
          <button
            type="button"
            className="work-tab"
            data-active={mobileView === "details"}
            aria-selected={mobileView === "details"}
            onClick={() => setMobileView("details")}
          >
            Details
          </button>
        </div>

        <div className="work-body" data-mobile-view={mobileView}>
          <section className="dash-card work-copilot">
            <div className="work-copilot-head">
              <h2 className="work-copilot-title">Copilot</h2>
            </div>
            <div className="work-copilot-body">
              <ChatPane
                ticketId={selectedId}
                role={role}
                bare
                emptyHint={
                  isDispatch
                    ? "Tell Railio what the engineer reported. It writes the pre-arrival briefing."
                    : "Tell Railio what you see. Use the mic in the shop."
                }
              />
            </div>
          </section>

          <aside className="work-context">
            {isDispatch ? (
              <IntakeContext
                ticketId={selectedId}
                onHandedOff={() => select(null)}
              />
            ) : (
              <RepairContext ticketId={selectedId} />
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function WorkHeader({
  ticket,
  role,
  back,
  onStart,
  starting,
  onHandoff,
  handingOff,
  onWrapUp,
}: {
  ticket: Ticket | undefined;
  role: Role;
  back: { href: string; label: string };
  onStart: () => void;
  starting: boolean;
  onHandoff: () => void;
  handingOff: boolean;
  onWrapUp: () => void;
}) {
  const isTech = role === "tech";
  return (
    <header className="work-head">
      <Link href={back.href} className="work-toggle dash-link">
        <span className="ico-arr-back" aria-hidden="true" /> {back.label}
      </Link>
      <div className="work-head-row">
        <div className="work-head-left">
          <h1 className="work-title">
            {ticket ? (
              <>
                <span className="work-title-prefix">Ticket </span>#
                {ticket.short_id}
              </>
            ) : (
              "Ticket"
            )}
          </h1>
          {ticket && (
            <>
              <span className={`dash-sev dash-sev-${ticket.severity}`}>
                {ticket.severity.toUpperCase()}
              </span>
              <span className="work-status">
                <span
                  className="work-status-dot"
                  style={{ background: statusDotColor(ticket.status as TicketStatus) }}
                />
                {statusLabel(ticket.status as TicketStatus)}
              </span>
            </>
          )}
        </div>
        {ticket && (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {isTech && ticket.status === "AWAITING_TECH" && (
              <button className="work-cta" onClick={onStart} disabled={starting}>
                {starting ? "Starting…" : "Start Work"}
              </button>
            )}
            {isTech && ticket.status === "IN_PROGRESS" && (
              <button className="work-cta" onClick={onWrapUp}>
                Complete &amp; wrap up
              </button>
            )}
            {!isTech && ticket.status === "AWAITING_TECH" && (
              <button className="work-cta" onClick={onHandoff} disabled={handingOff}>
                {handingOff ? "Handing off…" : <>Hand off to tech <span className="ico-arr" aria-hidden="true" /></>}
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

/**
 * The full ticket board — the dashboard "Tickets" table rendered as the whole
 * /work page. Rows route to the chat view via from=tickets so the chat's back
 * button reads "All tickets".
 */
function TicketList({
  role,
  tickets,
  isLoading,
  error,
  openCount,
  openByAsset,
  onSelect,
}: {
  role: Role;
  tickets: Ticket[];
  isLoading: boolean;
  error: boolean;
  openCount: number;
  openByAsset: Map<number, number>;
  onSelect: (shortId: string | null) => void;
}) {
  const isDispatch = role === "dispatcher";
  const [unitFilter, setUnitFilter] = useState<string>("all");

  const units = useMemo(
    () => Array.from(new Set(tickets.map((t) => unitLabel(t.asset)))).sort(),
    [tickets],
  );
  const visible = useMemo(
    () =>
      unitFilter === "all"
        ? tickets
        : tickets.filter((t) => unitLabel(t.asset) === unitFilter),
    [tickets, unitFilter],
  );

  return (
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
        <p className="dash-section-sub" style={{ marginTop: 0 }}>
          {tickets.length} total · {openCount} open
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {isDispatch && (
            <Link href="/dispatcher/new" className="work-drawer-new">
              + New ticket
            </Link>
          )}
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

        {isLoading && (
          <div className="dash-row dash-wo">
            <span className="dash-sub">Loading tickets…</span>
          </div>
        )}

        {error && (
          <div className="dash-row dash-wo">
            <span className="dash-sub">
              Backend unreachable — make sure the backend is on port 3001.
            </span>
          </div>
        )}

        {!isLoading && !error && visible.length === 0 && (
          <div className="dash-row dash-wo">
            <span className="dash-sub">
              {isDispatch
                ? "No tickets yet. Open one so the tech has context."
                : "Tickets handed off by dispatch show up here."}
            </span>
          </div>
        )}

        {visible.map((t) => {
          const count = openByAsset.get(t.asset.id) ?? 0;
          const symptom = t.title || t.initial_symptoms || "—";
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.short_id)}
              className="dash-row dash-wo dash-row--click"
              style={{ textAlign: "left" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="dash-id">#{t.short_id || t.id}</span>
                <span className="dash-unit">
                  {unitLabel(t.asset)} · {t.asset.unit_model}
                </span>
                {count > 0 && (
                  <span className="dash-count" data-on={count > 1}>
                    {count}
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
            </button>
          );
        })}
      </div>
    </section>
  );
}
