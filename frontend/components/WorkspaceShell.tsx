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

/**
 * Role-driven master-detail workspace. The ticket is the unit of work; the
 * locomotive is an attribute shown inside the detail. Dispatcher lands
 * list-forward (triage); tech lands detail-forward (focus). When a ticket is
 * open, the list collapses out of the way (focus mode) so the ticket owns the
 * screen.
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

  const focusMode = selectedId != null;

  function select(id: number | null) {
    router.push(id == null ? "/work" : `/work?ticket=${id}`);
  }

  function switchRole(next: Role) {
    setRoleCookie(next);
    setRole(next);
    select(null);
  }

  return (
    <div
      className="workspace"
      style={{
        height: "calc(100vh - 56px)",
        display: "grid",
        gridTemplateColumns: focusMode ? "minmax(0, 320px) 1fr" : "1fr",
        minHeight: 0,
      }}
    >
      {/* Master list — full width when nothing selected, slim rail in focus mode */}
      <aside
        className={focusMode ? "workspace-rail" : ""}
        style={{
          borderRight: focusMode ? "1px solid var(--border)" : "none",
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: focusMode ? "16px 16px 12px" : "32px 0 16px",
          }}
          className={focusMode ? "" : "wrap"}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <span className="sect-eyebrow">
                {role === "dispatcher" ? "Dispatcher" : "Tech"} · Tickets
              </span>
              {!focusMode && (
                <h1 className="h2" style={{ marginTop: 12 }}>
                  {role === "dispatcher" ? "Open Tickets" : "On The Floor"}
                </h1>
              )}
            </div>
            {!focusMode && (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <RoleToggle role={role} onChange={switchRole} />
                {role === "dispatcher" && (
                  <Link href="/dispatcher/new" className="btn btn-super btn-sm">
                    + New ticket
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>

        <div
          className={focusMode ? "" : "wrap"}
          style={{ flex: 1, minHeight: 0, paddingBottom: 24 }}
        >
          {isLoading && (
            <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>
              Loading tickets…
            </div>
          )}
          {error && (
            <div className="card" style={{ borderColor: "#f08d80" }}>
              <div className="micro" style={{ color: "#8a1f15" }}>
                Backend unreachable
              </div>
              <p style={{ marginTop: 8, color: "var(--muted)", fontSize: 13 }}>
                Could not load tickets. Make sure the backend is on port 3001.
              </p>
            </div>
          )}
          {!isLoading && !error && tickets.length === 0 && (
            <div
              className="card"
              style={{ textAlign: "center", color: "var(--muted)" }}
            >
              <div className="micro">No tickets</div>
              <p style={{ marginTop: 8, fontSize: 13 }}>
                {role === "dispatcher"
                  ? "Open a ticket so the tech has context."
                  : "Tickets handed off by dispatch show up here."}
              </p>
            </div>
          )}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: focusMode ? 6 : 8,
            }}
          >
            {tickets.map((t) => (
              <TicketCard
                key={t.id}
                ticket={t}
                compact={focusMode}
                active={t.id === selectedId}
                onClick={() => select(t.id)}
              />
            ))}
          </div>
        </div>
      </aside>

      {/* Detail — only in focus mode */}
      {focusMode && selectedId != null && (
        <main style={{ minHeight: 0, overflow: "hidden", position: "relative" }}>
          <TicketDetail
            ticketId={selectedId}
            role={role}
            onBack={() => select(null)}
          />
        </main>
      )}
    </div>
  );
}

function TicketCard({
  ticket,
  active,
  compact,
  onClick,
}: {
  ticket: Ticket;
  active: boolean;
  compact: boolean;
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
        borderLeft: active ? "3px solid var(--mta)" : "3px solid transparent",
        background: active ? "var(--mta-soft)" : "#fff",
        padding: compact ? "10px 12px" : "16px",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        width: "100%",
        font: "inherit",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
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
      {!compact && (
        <div className="micro" style={{ color: "var(--muted)" }}>
          Opened {formatDate(ticket.opened_at)}
        </div>
      )}
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
  return (
    <div style={{ display: "inline-flex", border: "1px solid var(--border)" }}>
      {(["tech", "dispatcher"] as Role[]).map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          style={{
            padding: "6px 12px",
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            border: "none",
            cursor: "pointer",
            background: role === r ? "var(--mta)" : "#fff",
            color: role === r ? "#fff" : "var(--ink)",
          }}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
