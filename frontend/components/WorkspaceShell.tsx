"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getTicket, listTickets, patchTicket } from "@/lib/api";
import { statusLabel } from "@/lib/format";
import { visibleTickets } from "@/lib/tickets";
import { useRole } from "@/components/RoleProvider";
import type { Role } from "@/lib/role";
import type { Ticket, TicketStatus } from "@/lib/contract";

// Figma status pill: white pill with a status-colored dot.
function statusDotColor(status: TicketStatus): string {
  switch (status) {
    case "AWAITING_HANDOFF":
      return "#7a7a7e";
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

// Priority rank for the "Priority" sort — lower sorts first (most urgent on top).
const SEV_RANK: Record<Ticket["severity"], number> = { critical: 0, major: 1, minor: 2 };

type SortMode = "priority" | "locomotive";

// Status filter pills. "open" is the union of every non-closed state; the rest
// map to a single TicketStatus. Order mirrors the ticket lifecycle.
type StatusFilter = "all" | "open" | TicketStatus;
const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "AWAITING_HANDOFF", label: "Awaiting handoff" },
  { value: "AWAITING_TECH", label: "Awaiting tech" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "AWAITING_REVIEW", label: "Awaiting review" },
  { value: "CLOSED", label: "Closed" },
];

function matchesStatus(t: Ticket, f: StatusFilter): boolean {
  if (f === "all") return true;
  if (f === "open") return t.status !== "CLOSED";
  return t.status === f;
}

import { ChatPane } from "./ChatPane";
import { ticketSession } from "@/lib/chatSession";
import { RepairContext } from "./RepairContext";
import { IntakeContext } from "./IntakeContext";
import { WrapUpForm } from "./WrapUpForm";

// Context drawer sizing. Collapsed by default so the chat owns the page; the
// tech drags the left edge to resize and the width/open state persists to
// localStorage (mirrors the resizable-column pattern in PartsAdmin).
const SIDEBAR_MIN = 300;
const SIDEBAR_MAX = 620;
const SIDEBAR_DEFAULT = 400;
const SIDEBAR_KEY = "railio_work_sidebar";
const WRAPUP_KEY = "railio_work_wrapup";

function clampWidth(w: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));
}

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
  const [mobileView, setMobileView] = useState<"chat" | "details" | "wrapup">("chat");

  // Desktop: the wrap-up record form opens as an in-flow right-side drawer that
  // compresses the chat (chat stays interactive). Drag-resizable like the left
  // context drawer, its width persisted. On mobile it's a third "Wrap up" tab.
  const [wrapOpen, setWrapOpen] = useState(false);
  const [wrapWidth, setWrapWidth] = useState(SIDEBAR_DEFAULT);

  // Desktop context drawer: open by default on every load. Only the width is
  // persisted — the open/collapsed state intentionally resets to open so the
  // details are always visible when the chat page loads.
  const [ctxOpen, setCtxOpen] = useState(true);
  const [ctxWidth, setCtxWidth] = useState(SIDEBAR_DEFAULT);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  // Hydrate the persisted widths after mount (client-only; keeps first paint
  // deterministic so there is no hydration mismatch).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.width === "number") setCtxWidth(clampWidth(s.width));
      }
      const wr = localStorage.getItem(WRAPUP_KEY);
      if (wr) {
        const s = JSON.parse(wr);
        if (typeof s.width === "number") setWrapWidth(clampWidth(s.width));
      }
    } catch {
      // ignore malformed storage
    }
  }, []);

  // Write-through the widths only (not open/collapsed — those always reset).
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ width: ctxWidth }));
    } catch {
      // ignore quota/availability errors
    }
  }, [ctxWidth]);
  useEffect(() => {
    try {
      localStorage.setItem(WRAPUP_KEY, JSON.stringify({ width: wrapWidth }));
    } catch {
      // ignore quota/availability errors
    }
  }, [wrapWidth]);

  // Switching tickets closes any open wrap-up drawer (mirrors why ctxOpen resets).
  useEffect(() => {
    setWrapOpen(false);
  }, [selectedId]);

  // Drag the drawer's right edge: dragging right (larger clientX) widens it.
  function onResizeDown(e: React.PointerEvent) {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartW.current = ctxWidth;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    function onMove(ev: PointerEvent) {
      setCtxWidth(clampWidth(dragStartW.current + (ev.clientX - dragStartX.current)));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Drag the wrap-up drawer's left edge: it sits on the right, so dragging left
  // (smaller clientX) widens it — the inverse of the left context drawer.
  function onWrapResizeDown(e: React.PointerEvent) {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartW.current = wrapWidth;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    function onMove(ev: PointerEvent) {
      setWrapWidth(clampWidth(dragStartW.current - (ev.clientX - dragStartX.current)));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

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

  // The mobile "Wrap up" tab only exists for a tech on an in-progress ticket;
  // if that stops being true (e.g. the ticket just got filed/closed) while the
  // tab is active, fall back to the chat so the view isn't stranded.
  useEffect(() => {
    if (mobileView === "wrapup" && !(role === "tech" && ticket?.status === "IN_PROGRESS")) {
      setMobileView("chat");
    }
  }, [mobileView, role, ticket?.status]);

  // Every role gets the full board here — the status pills below do the
  // narrowing (a tech simply defaults to the "Open" pill). Pre-filtering by
  // role would strip CLOSED tickets from the list entirely, leaving the Closed
  // pill permanently empty for techs.
  const tickets: Ticket[] = data || [];

  const isDispatch = role === "dispatcher";

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

          <TicketList
            role={role}
            tickets={tickets}
            isLoading={isLoading}
            error={!!error}
            onSelect={select}
            initialStatus={params.get("status")}
          />
        </div>
      </div>
    );
  }

  const back =
    from === "dashboard"
      ? { href: "/dashboard", label: "Dashboard" }
      : { href: "/work", label: "All tickets" };
  const isTech = role === "tech";

  return (
    <div className="work work--full">
      <div className="work-inner">
        {/* Slim always-on row above the chat: back link (left) + the role
            action (right). Kept out of the drawer so the action is reachable
            even while the drawer is collapsed. */}
        <div className="work-topbar">
          <Link href={back.href} className="work-topbar-back dash-link">
            <span className="ico-arr-back" aria-hidden="true" /> {back.label}
          </Link>
          {ticket && (
            <div className="work-topbar-actions">
              {isTech && ticket.status === "AWAITING_TECH" && (
                <button
                  className="work-cta"
                  onClick={() => startMut.mutate()}
                  disabled={startMut.isPending}
                >
                  {startMut.isPending ? "Starting…" : "Start Work"}
                </button>
              )}
              {isTech && ticket.status === "IN_PROGRESS" && (
                (wrapOpen || mobileView === "wrapup") ? (
                  <button
                    type="button"
                    className="work-cta work-cta-secondary"
                    onClick={() => {
                      setWrapOpen(false);
                      setMobileView("chat");
                    }}
                  >
                    Continue working
                  </button>
                ) : (
                  <button
                    className="work-cta"
                    onClick={() => {
                      // Desktop opens the drawer; mobile switches to the tab.
                      // Setting both is safe — each layout reads only its own.
                      setWrapOpen(true);
                      setMobileView("wrapup");
                    }}
                  >
                    Complete &amp; wrap up
                  </button>
                )
              )}
              {/* Handing off is what releases the ticket to the tech's queue, so
                  it can happen exactly once. After that the button stays as a
                  disabled receipt rather than vanishing — the dispatcher needs to
                  see that it went through. */}
              {!isTech && ticket.status === "AWAITING_HANDOFF" && (
                <button
                  className="work-cta"
                  onClick={() => handoffMut.mutate()}
                  disabled={handoffMut.isPending}
                >
                  {handoffMut.isPending ? (
                    "Handing off…"
                  ) : (
                    <>
                      Hand off to tech <span className="ico-arr" aria-hidden="true" />
                    </>
                  )}
                </button>
              )}
              {!isTech &&
                ticket.status !== "AWAITING_HANDOFF" &&
                ticket.status !== "CLOSED" && (
                  <button className="work-cta" disabled>
                    Handed off
                  </button>
                )}
            </div>
          )}
        </div>

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
          {isTech && ticket?.status === "IN_PROGRESS" && (
            <button
              type="button"
              className="work-tab"
              data-active={mobileView === "wrapup"}
              aria-selected={mobileView === "wrapup"}
              onClick={() => setMobileView("wrapup")}
            >
              Wrap up
            </button>
          )}
        </div>

        <div className="work-body" data-mobile-view={mobileView} data-ctx-open={ctxOpen}>
          {/* Left in-flow drawer: collapsed by default, drag-resizable, pushes
              the chat narrower when open. On mobile it becomes the "Details"
              tab panel. */}
          <aside
            className="work-ctx-drawer"
            data-open={ctxOpen}
            style={{ width: ctxOpen ? ctxWidth : 0 }}
            aria-hidden={!ctxOpen}
          >
            <div className="work-ctx-head">
              {ticket && <span className="work-ctx-title">#{ticket.short_id}</span>}
              <button
                type="button"
                className="work-ctx-close"
                onClick={() => setCtxOpen(false)}
                aria-label="Collapse details"
              >
                <span className="ico-sidebar" aria-hidden="true" />
              </button>
            </div>

            <div className="work-context work-ctx-body">
              {ticket && (
                <div className="work-ctx-meta">
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
                </div>
              )}

              {isDispatch ? (
                <IntakeContext
                  ticketId={selectedId}
                  onHandedOff={() => select(null)}
                />
              ) : (
                <RepairContext ticketId={selectedId} />
              )}
            </div>

            {/* Resize handle on the drawer's right edge (the seam with the chat). */}
            <div
              className="work-ctx-resize"
              onPointerDown={onResizeDown}
              aria-label="Drag to resize"
            />
          </aside>

          {/* Collapsed-only: a thin vertical bar standing in for the drawer —
              an expand arrow up top with a divider under it, empty below.
              Clicking pulls the details out. */}
          {!ctxOpen && (
            <button
              type="button"
              className="work-ctx-open"
              onClick={() => setCtxOpen(true)}
              aria-label="Show details"
            >
              <span className="work-ctx-open-head">
                <span className="ico-sidebar" aria-hidden="true" />
              </span>
            </button>
          )}

          <section className="dash-card work-copilot">
            <div className="work-copilot-body">
              <ChatPane
                session={ticketSession(ticket, selectedId)}
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

          {/* Wrap-up panel: an in-flow right-side column, so opening it
              compresses the chat rather than covering it — the tech can keep
              chatting while writing the record. On desktop it's toggled by the
              "Complete & wrap up" button (wrapOpen); on mobile it's the third
              "Wrap up" tab. */}
          {isTech && ticket && ticket.status === "IN_PROGRESS" && (
            <aside
              className="work-wrapup"
              data-open={wrapOpen}
              style={{ width: wrapWidth }}
              role="region"
              aria-label="Wrap up"
            >
              {/* Resize handle on the left edge (the seam with the chat). */}
              <div
                className="work-wrapup-resize"
                onPointerDown={onWrapResizeDown}
                aria-label="Drag to resize"
              />
              <div className="work-wrapup-head">
                <span className="work-ctx-title">Wrap up</span>
                <button
                  type="button"
                  className="work-wrapup-continue"
                  onClick={() => {
                    setWrapOpen(false);
                    setMobileView("chat");
                  }}
                  aria-label="Continue working"
                >
                  <span className="work-wrapup-continue-x" aria-hidden="true">×</span>
                </button>
              </div>
              <div className="work-wrapup-body">
                <WrapUpForm
                  ticketId={selectedId}
                  onFiled={() => {
                    // Show the "Record filed" note briefly, then return the tech
                    // to wherever they opened the ticket from. Driven here (not
                    // in WrapUpForm) so it survives the form unmounting when the
                    // ticket flips to CLOSED on mobile.
                    setTimeout(() => router.push(back.href), 1500);
                  }}
                />
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
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
  onSelect,
  initialStatus,
}: {
  role: Role;
  tickets: Ticket[];
  isLoading: boolean;
  error: boolean;
  onSelect: (shortId: string | null) => void;
  /** Preset the status filter from a deep link, e.g. /work?status=open. */
  initialStatus?: string | null;
}) {
  const isDispatch = role === "dispatcher";
  const [unitFilter, setUnitFilter] = useState<string>("all");
  // A deep-link (?status=open from the dashboard "Open tickets" card) wins;
  // otherwise a tech lands on the actionable board ("Open") and dispatch sees all.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const preset = STATUS_FILTERS.find((f) => f.value === initialStatus)?.value;
    return preset ?? (role === "tech" ? "open" : "all");
  });
  const [sortMode, setSortMode] = useState<SortMode>("priority");

  // Everything below counts off this, not the raw list: a tech must never see
  // a ticket the dispatcher still holds — including in the pill counts.
  const pool = useMemo(() => visibleTickets(tickets, role), [tickets, role]);

  // Handing off is dispatch's move, so the pill is theirs too.
  const filters = useMemo(
    () =>
      STATUS_FILTERS.filter(
        (f) => f.value !== "AWAITING_HANDOFF" || role !== "tech",
      ),
    [role],
  );

  const units = useMemo(
    () => Array.from(new Set(pool.map((t) => unitLabel(t.asset)))).sort(),
    [pool],
  );

  // Count of tickets in each status bucket, shown on the pills so the operator
  // can see the board's shape at a glance. Reflects the locomotive filter.
  const statusCounts = useMemo(() => {
    const scoped =
      unitFilter === "all"
        ? pool
        : pool.filter((t) => unitLabel(t.asset) === unitFilter);
    const m = new Map<StatusFilter, number>();
    for (const f of filters) {
      m.set(f.value, scoped.filter((t) => matchesStatus(t, f.value)).length);
    }
    return m;
  }, [pool, unitFilter, filters]);

  const visible = useMemo(() => {
    const filtered = pool.filter(
      (t) =>
        (unitFilter === "all" || unitLabel(t.asset) === unitFilter) &&
        matchesStatus(t, statusFilter),
    );
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
  }, [tickets, unitFilter, statusFilter, sortMode]);

  return (
    <>
      {/* Page header: title on the left, status-filter pills right-aligned on
          the same row. Closed tickets live under the "Closed" pill (they're
          pulled off the dashboard), so this is where you go to find them. */}
      <div className="tickets-header">
        <h1 className="h2" style={{ margin: 0 }}>
          All tickets
        </h1>
        <div
          className="ticket-status-pills"
          role="group"
          aria-label="Filter by status"
        >
          {filters.map((f) => {
            const n = statusCounts.get(f.value) ?? 0;
            return (
              <button
                key={f.value}
                type="button"
                className="ticket-status-pill"
                data-active={statusFilter === f.value}
                aria-pressed={statusFilter === f.value}
                onClick={() => setStatusFilter(f.value)}
              >
                {f.label} <span className="ticket-status-pill-count">· {n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <section className="dash-card" style={{ padding: "22px 28px" }}>
        {/* "+ New ticket" sits at the card's left edge; the filters are pushed to
            the right by their own auto margin, so they stay right-aligned whether
            or not the dispatch button is present. */}
        <div className="dash-tickets-head" style={{ marginBottom: 14 }}>
          {isDispatch && (
            <Link href="/dispatcher/new" className="work-drawer-new">
              + New ticket
            </Link>
          )}
          <div
            className="dash-tickets-controls"
            style={{ marginLeft: "auto" }}
          >
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
              {statusFilter !== "all" || unitFilter !== "all"
                ? "No tickets match these filters."
                : isDispatch
                  ? "No tickets yet. Open one so the tech has context."
                  : "Tickets handed off by dispatch show up here."}
            </span>
          </div>
        )}

        {visible.map((t) => {
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
            </button>
          );
        })}
        </div>
      </section>
    </>
  );
}
