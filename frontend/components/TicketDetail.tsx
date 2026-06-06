"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { getTicket, patchTicket } from "@/lib/api";
import { ChatPane } from "./ChatPane";
import { RepairContext } from "./RepairContext";
import { formatDate, statusLabel, statusPillClass } from "@/lib/format";
import type { Role } from "@/lib/role";
import type { TicketStatus } from "@/lib/contract";

/**
 * Detail pane of the workspace. Tech gets chat + repair context + lifecycle
 * actions; dispatcher gets the briefing chat. The list lives in the shell; this
 * pane owns the screen in focus mode (a back affordance returns to the list).
 */
export function TicketDetail({
  ticketId,
  role,
  onBack,
}: {
  ticketId: number;
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
      className="ticket-shell"
      style={{
        padding: "16px 0 0",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div className="wrap" style={{ marginBottom: 12 }}>
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
          }}
        >
          ← All tickets
        </button>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            marginTop: 4,
          }}
        >
          <div>
            <h1 className="h2">Ticket #{ticketId}</h1>
            {ticket && (
              <span className="micro" style={{ color: "var(--muted)" }}>
                {ticket.asset.reporting_mark} {ticket.asset.road_number} ·{" "}
                {ticket.asset.unit_model} · opened {formatDate(ticket.opened_at)}
              </span>
            )}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
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
        </div>
      </div>

      <div
        className="wrap split-2col"
        style={{
          flex: 1,
          minHeight: 0,
          gridTemplateColumns: isTech ? "1.3fr .9fr" : "1fr",
          gap: isTech ? 0 : 24,
          paddingBottom: 16,
        }}
      >
        <div style={{ minHeight: 0 }}>
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
        {isTech && (
          <div style={{ minHeight: 0, overflow: "hidden" }}>
            <RepairContext ticketId={ticketId} />
          </div>
        )}
      </div>
    </section>
  );
}
