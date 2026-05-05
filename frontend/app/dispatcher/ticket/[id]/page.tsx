"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getTicket } from "@/lib/api";
import { ChatPane } from "@/components/ChatPane";
import { formatDate, statusLabel, statusPillClass } from "@/lib/format";
import type { TicketStatus } from "@/lib/contract";

export default function DispatcherTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const ticketId = Number(id);

  const { data: ticket } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => getTicket(ticketId),
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
        <Link href="/dispatcher" className="micro" style={{ color: "var(--muted)" }}>
          ← Back to queue
        </Link>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginTop: 4,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <h1 className="h2">Ticket #{ticketId}</h1>
          {ticket && (
            <div
              style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
            >
              <span className="micro" style={{ color: "var(--muted)" }}>
                Opened {formatDate(ticket.opened_at)}
              </span>
              <span className={statusPillClass(ticket.status as TicketStatus)}>
                {statusLabel(ticket.status as TicketStatus)}
              </span>
            </div>
          )}
        </div>
      </div>

      <div
        className="wrap split-2col"
        style={{
          flex: 1,
          minHeight: 0,
          gridTemplateColumns: "1fr 1.3fr",
          gap: 24,
          paddingBottom: 16,
        }}
      >
        <div className="card" style={{ overflow: "auto" }}>
          <span className="sect-eyebrow">Briefing</span>
          {ticket ? (
            <div style={{ marginTop: 16 }}>
              <Field
                label="Asset"
                value={`${ticket.asset.reporting_mark} ${ticket.asset.road_number} · ${ticket.asset.unit_model}`}
              />
              <Field label="Symptoms" value={ticket.initial_symptoms || "—"} />
              <Field
                label="Initial error codes"
                value={ticket.initial_error_codes || "—"}
              />
              {ticket.fault_dump_parsed && ticket.fault_dump_parsed.length > 0 && (
                <Field
                  label="Parsed faults"
                  value={
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {ticket.fault_dump_parsed.map((p, i) => (
                        <span key={i} className={`pill sev-${p.severity}`}>
                          {p.code}
                        </span>
                      ))}
                    </div>
                  }
                />
              )}
              <Field
                label="Pre-arrival summary"
                value={
                  ticket.pre_arrival_summary || (
                    <span style={{ color: "var(--muted)" }}>
                      Not yet written.
                    </span>
                  )
                }
              />
            </div>
          ) : (
            <div className="micro" style={{ color: "var(--muted)", marginTop: 16 }}>
              Loading…
            </div>
          )}
        </div>
        <div style={{ minHeight: 0 }}>
          <ChatPane
            ticketId={ticketId}
            role="dispatcher"
            emptyHint="Use this thread to wrap up the briefing for the tech."
          />
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div
      className="form-field-row"
      style={{
        display: "grid",
        gridTemplateColumns: "140px 1fr",
        gap: 12,
        padding: "10px 0",
        borderBottom: "1px solid var(--pale)",
        fontSize: 14,
      }}
    >
      <div className="micro" style={{ alignSelf: "center" }}>{label}</div>
      <div>{value}</div>
    </div>
  );
}
