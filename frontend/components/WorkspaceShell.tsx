"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { listTickets } from "@/lib/api";
import { formatDate, statusLabel, statusPillClass } from "@/lib/format";
import { getRoleCookie, setRoleCookie, type Role } from "@/lib/role";
import type { Ticket, TicketStatus } from "@/lib/contract";
import { TicketDetail } from "./TicketDetail";
import { RepairContext } from "./RepairContext";
import { IntakeContext } from "./IntakeContext";

/**
 * Persistent 3-pane workspace: ticket rail · chat · role context. All three
 * regions are always reserved, so selecting a ticket fills the center/context
 * columns rather than reshaping the rail — no layout jump, no throwaway landing
 * screen. The mode banner + accent make the active role unmistakable.
 */
export function WorkspaceShell() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("ticket") ? Number(params.get("ticket")) : null;

  const [role, setRole] = useState<Role>("tech");
  useEffect(() => {
    setRole(getRoleCookie() || "tech");
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ["tickets", "workspace"],
    queryFn: () => listTickets(),
    refetchInterval: 8000,
  });

  // Tech sees only actionable tickets; dispatcher sees the whole board.
  const filter = role === "tech" ? ["AWAITING_TECH", "IN_PROGRESS"] : null;
  const tickets: Ticket[] = (data || []).filter((t) =>
    filter ? filter.includes(t.status) : true,
  );

  const isDispatch = role === "dispatcher";
  const accent = isDispatch ? "var(--dispatch)" : "var(--tech)";

  function select(id: number | null) {
    router.push(id == null ? "/work" : `/work?ticket=${id}`);
  }

  function switchRole(next: Role) {
    setRoleCookie(next);
    setRole(next);
    select(null);
  }

  return (
    <div className="workspace">
      {/* Left rail — ticket queue, always visible */}
      <aside
        className={`pane workspace-rail${selectedId != null ? " rail-hidden" : ""}`}
      >
        <div className={`mode-banner mode-banner--${isDispatch ? "dispatch" : "tech"}`}>
          <span className="mode-title">
            {isDispatch ? "Dispatch mode" : "Tech mode"}
          </span>
          <span className="mode-sub">
            {isDispatch ? "Triage & hand off" : "Repair & wrap up"}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--s2)",
            padding: "var(--s3) var(--s4)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <RoleToggle role={role} onChange={switchRole} />
          {isDispatch && (
            <Link href="/dispatcher/new" className="btn btn-super btn-sm">
              + New
            </Link>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "var(--s3)" }}>
          {isLoading && (
            <div style={{ padding: "var(--s4)", color: "var(--muted)", fontSize: 13 }}>
              Loading tickets…
            </div>
          )}
          {error && (
            <div className="card-tight" style={{ borderColor: "#f08d80" }}>
              <div className="micro" style={{ color: "#8a1f15" }}>
                Backend unreachable
              </div>
              <p style={{ marginTop: "var(--s2)", color: "var(--muted)", fontSize: 13 }}>
                Make sure the backend is on port 3001.
              </p>
            </div>
          )}
          {!isLoading && !error && tickets.length === 0 && (
            <div
              className="card-tight"
              style={{ textAlign: "center", color: "var(--muted)" }}
            >
              <div className="micro">No tickets</div>
              <p style={{ marginTop: "var(--s2)", fontSize: 13 }}>
                {isDispatch
                  ? "Open a ticket so the tech has context."
                  : "Tickets handed off by dispatch show up here."}
              </p>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--s2)" }}>
            {tickets.map((t) => (
              <TicketCard
                key={t.id}
                ticket={t}
                accent={accent}
                active={t.id === selectedId}
                onClick={() => select(t.id)}
              />
            ))}
          </div>
        </div>
      </aside>

      {/* Center — chat or guided empty state */}
      <main className="pane workspace-center">
        {selectedId != null ? (
          <TicketDetail
            ticketId={selectedId}
            role={role}
            onBack={() => select(null)}
          />
        ) : (
          <WorkspaceEmpty role={role} />
        )}
      </main>

      {/* Right — role context (tech repair context / dispatcher intake) */}
      <aside className="pane workspace-context">
        {selectedId != null ? (
          isDispatch ? (
            <IntakeContext ticketId={selectedId} onHandedOff={() => select(null)} />
          ) : (
            <RepairContext ticketId={selectedId} />
          )
        ) : (
          <div className="context-placeholder">
            <span className="micro">
              {isDispatch ? "Intake details" : "Repair context"}
            </span>
          </div>
        )}
      </aside>
    </div>
  );
}

function WorkspaceEmpty({ role }: { role: Role }) {
  const isDispatch = role === "dispatcher";
  return (
    <div className="workspace-empty">
      <div style={{ maxWidth: 380 }}>
        <span className="sect-eyebrow">
          {isDispatch ? "Dispatch" : "Tech"}
        </span>
        <h2 className="h3" style={{ marginTop: "var(--s3)" }}>
          {isDispatch ? "Select or open a ticket" : "Pick a unit to start"}
        </h2>
        <p style={{ marginTop: "var(--s3)", color: "var(--muted)", fontSize: 14 }}>
          {isDispatch
            ? "Choose a ticket from the queue to brief the tech, or open a new one."
            : "Choose a ticket handed off by dispatch to begin the walk-through."}
        </p>
        {isDispatch && (
          <Link
            href="/dispatcher/new"
            className="btn btn-super"
            style={{ marginTop: "var(--s4)" }}
          >
            + New ticket
          </Link>
        )}
      </div>
    </div>
  );
}

function TicketCard({
  ticket,
  active,
  accent,
  onClick,
}: {
  ticket: Ticket;
  active: boolean;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ticket-card"
      style={{
        textAlign: "left",
        border: "1px solid var(--border)",
        borderLeft: active ? `3px solid ${accent}` : "3px solid transparent",
        background: active ? "var(--pale)" : "#fff",
        padding: "10px 12px",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "var(--s1)",
        width: "100%",
        font: "inherit",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "var(--s2)",
        }}
      >
        <span className="qid" style={{ fontWeight: 700 }}>
          #{ticket.id} · {ticket.asset.reporting_mark} {ticket.asset.road_number}
        </span>
        <span className={statusPillClass(ticket.status as TicketStatus)}>
          {statusLabel(ticket.status as TicketStatus)}
        </span>
      </div>
      <div
        style={{
          color: "var(--muted)",
          fontSize: 13,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {ticket.asset.unit_model} ·{" "}
        {ticket.initial_symptoms || ticket.initial_error_codes || "No symptoms"}
      </div>
      <div className="micro" style={{ color: "var(--muted)" }}>
        Opened {formatDate(ticket.opened_at)}
      </div>
    </button>
  );
}

function RoleToggle({
  role,
  onChange,
}: {
  role: Role;
  onChange: (r: Role) => void;
}) {
  const items: { value: Role; data: "tech" | "dispatch" }[] = [
    { value: "tech", data: "tech" },
    { value: "dispatcher", data: "dispatch" },
  ];
  return (
    <div className="seg-toggle">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          className="seg-toggle-item"
          data-role={it.data}
          data-active={role === it.value}
          onClick={() => onChange(it.value)}
        >
          {it.value}
        </button>
      ))}
    </div>
  );
}
