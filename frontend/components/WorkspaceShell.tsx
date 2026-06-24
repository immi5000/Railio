"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getTicket, listTickets, patchTicket } from "@/lib/api";
import { formatDate, statusLabel } from "@/lib/format";
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
import { ChatPane } from "./ChatPane";
import { RepairContext } from "./RepairContext";
import { IntakeContext } from "./IntakeContext";

/**
 * Work-order page (Figma redesign): a dashboard-styled detail view — page
 * header + Copilot chat card + stacked context cards — with the ticket queue
 * moved into an off-canvas drawer toggled by "← Open sidebar". Role CTAs
 * moved into an off-canvas drawer toggled by "← Open sidebar". Role CTAs
 * (start / wrap-up / hand off) live in the header; tech/dispatcher mode is
 * switched from the profile menu in the top nav.
 */
export function WorkspaceShell() {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const selectedId = params.get("ticket") || null;

  const { role } = useRole();

  // Drawer is open by default when no ticket is selected, closed once one is.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // On phones the body shows one panel at a time; always land on the chat.
  const [mobileView, setMobileView] = useState<"chat" | "details">("chat");
  useEffect(() => {
    setSidebarOpen(selectedId == null);
    setMobileView("chat");
  }, [selectedId]);

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

  function select(shortId: string | null) {
    router.push(shortId == null ? "/work" : `/work?ticket=${shortId}`);
    setSidebarOpen(false);
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

  return (
    <div className="work">
      <div className="work-inner">
        <WorkHeader
          ticket={selectedId != null ? ticket : undefined}
          role={role}
          onOpenSidebar={() => setSidebarOpen(true)}
          onStart={() => startMut.mutate()}
          starting={startMut.isPending}
          onHandoff={() => handoffMut.mutate()}
          handingOff={handoffMut.isPending}
          onWrapUp={() =>
            router.push(`/tech/ticket/${selectedId}/wrap-up`)
          }
        />

        {selectedId != null && (
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
        )}

        {selectedId != null ? (
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
        ) : (
          <div className="dash-card work-placeholder">
            Select a ticket from the sidebar to begin.
          </div>
        )}
      </div>

      <TicketDrawer
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        role={role}
        tickets={tickets}
        isLoading={isLoading}
        error={!!error}
        selectedId={selectedId}
        onSelect={select}
      />
    </div>
  );
}

function WorkHeader({
  ticket,
  role,
  onOpenSidebar,
  onStart,
  starting,
  onHandoff,
  handingOff,
  onWrapUp,
}: {
  ticket: Ticket | undefined;
  role: Role;
  onOpenSidebar: () => void;
  onStart: () => void;
  starting: boolean;
  onHandoff: () => void;
  handingOff: boolean;
  onWrapUp: () => void;
}) {
  const isTech = role === "tech";
  return (
    <header className="work-head">
      <button type="button" className="work-toggle dash-link" onClick={onOpenSidebar}>
        <span className="ico-arr-back" aria-hidden="true" /> Open sidebar
      </button>
      <div className="work-head-row">
        <div className="work-head-left">
          <h1 className="work-title">
            {ticket ? (
              <>
                <span className="work-title-prefix">Work order </span>#
                {ticket.short_id}
              </>
            ) : (
              "Select a ticket"
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

function TicketDrawer({
  open,
  onClose,
  role,
  tickets,
  isLoading,
  error,
  selectedId,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  role: Role;
  tickets: Ticket[];
  isLoading: boolean;
  error: boolean;
  selectedId: string | null;
  onSelect: (shortId: string | null) => void;
}) {
  const isDispatch = role === "dispatcher";
  return (
    <>
      {open && <div className="work-drawer-backdrop" onClick={onClose} />}
      <aside className={`work-drawer${open ? " is-open" : ""}`} aria-hidden={!open}>
        <div className="work-drawer-head">
          <span className="work-drawer-title">Tickets</span>
          <button type="button" className="work-drawer-close" onClick={onClose} aria-label="Close sidebar">
            ✕
          </button>
        </div>

        {isDispatch && (
          <div className="work-drawer-toolbar">
            <Link href="/dispatcher/new" className="work-drawer-new">
              + New ticket
            </Link>
          </div>
        )}

        <div className="work-drawer-list">
          {isLoading && (
            <div className="work-drawer-loading">Loading tickets…</div>
          )}
          {error && (
            <div className="work-drawer-error">
              <div className="work-drawer-error-title">Backend unreachable</div>
              <p className="work-drawer-error-body">
                Make sure the backend is on port 3001.
              </p>
            </div>
          )}
          {!isLoading && !error && tickets.length === 0 && (
            <div className="work-drawer-empty">
              {isDispatch
                ? "Open a ticket so the tech has context."
                : "Tickets handed off by dispatch show up here."}
            </div>
          )}

          {tickets.map((t) => (
            <TicketCard
              key={t.id}
              ticket={t}
              active={t.short_id === selectedId}
              onClick={() => onSelect(t.short_id)}
            />
          ))}
        </div>
      </aside>
    </>
  );
}

function TicketCard({
  ticket,
  active,
  onClick,
}: {
  ticket: Ticket;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="work-ticket" data-active={active}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "var(--s2)",
        }}
      >
        <span className="work-ticket-title">
          {ticket.title || `${ticket.asset.reporting_mark} ${ticket.asset.road_number}`}
        </span>
        <span className="work-status">
          <span
            className="work-status-dot"
            style={{ background: statusDotColor(ticket.status as TicketStatus) }}
          />
          {statusLabel(ticket.status as TicketStatus)}
        </span>
      </div>
      <div
        className="dash-mono"
        style={{
          color: "var(--dash-muted)",
          fontSize: 12,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {ticket.short_id} · {ticket.asset.reporting_mark} {ticket.asset.road_number} ·{" "}
        {ticket.asset.unit_model}
      </div>
      <div className="dash-mono" style={{ color: "var(--dash-faint)", fontSize: 11 }}>
        Opened {formatDate(ticket.opened_at)}
      </div>
    </button>
  );
}
