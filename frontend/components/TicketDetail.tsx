"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { getTicket, patchTicket } from "@/lib/api";
import { ChatPane } from "./ChatPane";
import { formatDate, statusLabel, statusPillClass } from "@/lib/format";
import type { Role } from "@/lib/role";
import type { TicketStatus } from "@/lib/contract";

/**
 * Center pane of the workspace: the ticket thread plus a lean, role-gated
 * header. The role context (repair context / intake details) is owned by the
 * shell's right column, so this pane is chat-only.
 */
export function TicketDetail({
  ticketId,
  role,
  onBack,
}: {
  ticketId: string;
  role: Role;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const { data: ticket } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => getTicket(ticketId),
  });

  const startMut = useMutation({
    mutationFn: () => patchTicket(ticketId, { status: "IN_PROGRESS" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });

  const isTech = role === "tech";

  return (
    <section
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--s4)",
          flexWrap: "wrap",
          padding: "var(--s4)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <button
            type="button"
            onClick={onBack}
            className="micro"
            style={{
              color: "var(--muted)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              marginBottom: "var(--s1)",
            }}
          >
            ← All tickets
          </button>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--s3)", flexWrap: "wrap" }}>
            <h1 className="h3">{ticket?.title || "Ticket"}</h1>
            {ticket && (
              <span className="micro" style={{ color: "var(--muted)" }}>
                {ticket.short_id} · {ticket.asset.reporting_mark}{" "}
                {ticket.asset.road_number} · {ticket.asset.unit_model}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)", flexWrap: "wrap" }}>
          {ticket && (
            <span className={statusPillClass(ticket.status as TicketStatus)}>
              {statusLabel(ticket.status as TicketStatus)}
            </span>
          )}
          {isTech && ticket?.status === "AWAITING_TECH" && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => startMut.mutate()}
              disabled={startMut.isPending}
            >
              {startMut.isPending ? "Starting…" : "Start work"}
            </button>
          )}
          {isTech && ticket?.status === "IN_PROGRESS" && (
            <button
              className="btn btn-super btn-sm"
              onClick={() => router.push(`/tech/ticket/${ticketId}/wrap-up`)}
            >
              Complete & wrap up
            </button>
          )}
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, padding: "var(--s4)" }}>
        <ChatPane
          ticketId={ticketId}
          role={role}
          emptyHint={
            isTech
              ? "Tell Railio what you see. Use the mic in the shop."
              : "Tell Railio what the engineer reported. It writes the pre-arrival briefing."
          }
        />
      </div>
    </section>
  );
}
