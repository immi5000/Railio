"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { getTicket, patchTicket } from "@/lib/api";
import { ChatPane } from "./ChatPane";
import { RepairContext } from "./RepairContext";
import { statusLabel, statusPillClass } from "@/lib/format";
import type { TicketStatus } from "@/lib/contract";

export function TechTicketView({ ticketId }: { ticketId: number }) {
  const qc = useQueryClient();
  const { data: ticket } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => getTicket(ticketId),
  });

  const closeMut = useMutation({
    mutationFn: () => patchTicket(ticketId, { status: "CLOSED" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });

  const startMut = useMutation({
    mutationFn: () => patchTicket(ticketId, { status: "IN_PROGRESS" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ticket", ticketId] }),
  });

  return (
    <section
      className="ticket-shell"
      style={{
        padding: "16px 0 0",
        height: "calc(100vh - 56px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div className="wrap" style={{ marginBottom: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <Link href="/tech" className="micro" style={{ color: "var(--muted)" }}>
              ← Back to queue
            </Link>
            <h1 className="h2" style={{ marginTop: 4 }}>
              Ticket #{ticketId}
            </h1>
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
            {ticket?.status === "AWAITING_TECH" && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => startMut.mutate()}
                disabled={startMut.isPending}
              >
                {startMut.isPending ? "Starting…" : "Start work"}
              </button>
            )}
            {ticket?.status === "IN_PROGRESS" && (
              <button
                className="btn btn-super btn-sm"
                onClick={() => closeMut.mutate()}
                disabled={closeMut.isPending}
              >
                {closeMut.isPending ? "Closing…" : "Close ticket"}
              </button>
            )}
            <Link
              href={`/tech/ticket/${ticketId}/forms`}
              className="btn btn-ghost btn-sm"
            >
              Open forms →
            </Link>
          </div>
        </div>
      </div>

      <div
        className="wrap split-2col"
        style={{
          flex: 1,
          minHeight: 0,
          gridTemplateColumns: "1.3fr .9fr",
          gap: 0,
          paddingBottom: 16,
        }}
      >
        <div style={{ minHeight: 0 }}>
          <ChatPane
            ticketId={ticketId}
            role="tech"
            emptyHint="Tell Railio what you see. Use the mic in the shop."
          />
        </div>
        <div style={{ minHeight: 0, overflow: "hidden" }}>
          <RepairContext ticketId={ticketId} />
        </div>
      </div>

    </section>
  );
}
