"use client";

import { useQuery } from "@tanstack/react-query";
import { getTicket } from "@/lib/api";
import type { Severity } from "@/lib/contract";
import { formatDate } from "@/lib/format";
import { ContextPanel, Empty } from "./ContextPanel";
import { DeleteTicketButton } from "./DeleteTicketButton";

const SEV_ABBR: Record<Severity, string> = {
  critical: "crit",
  major: "maj",
  minor: "min",
};

/**
 * Dispatcher counterpart to RepairContext. Surfaces what the dispatcher
 * captured (symptoms, codes, parsed faults, pre-arrival briefing). Rendered as
 * direct children of .work-context so the cards stack with the page's gap.
 */
export function IntakeContext({
  ticketId,
  onHandedOff,
}: {
  ticketId: string;
  onHandedOff: () => void;
}) {
  const { data: ticket } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => getTicket(ticketId),
  });

  if (!ticket) {
    return (
      <div className="wc-card">
        <span className="wc-sub">Loading intake…</span>
      </div>
    );
  }

  const codes = (ticket.initial_error_codes ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const faults = ticket.fault_dump_parsed || [];

  return (
    <>
      <div className="wc-card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="wc-head">
          <span className="wc-title">Unit &amp; intake</span>
          <span className="wc-link">{ticket.asset.unit_model}</span>
        </div>
        <div className="wc-unit">
          {ticket.asset.reporting_mark} {ticket.asset.road_number}
        </div>
        <div className="wc-sub">Opened {formatDate(ticket.opened_at)}</div>
      </div>

      <ContextPanel title="Reported symptoms" defaultOpen>
        {ticket.initial_symptoms ? (
          <p className="wc-symptom" style={{ whiteSpace: "pre-wrap" }}>
            {ticket.initial_symptoms}
          </p>
        ) : (
          <Empty>None recorded.</Empty>
        )}
      </ContextPanel>

      <ContextPanel title="Error codes" count={codes.length || undefined} defaultOpen={codes.length > 0}>
        {codes.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {codes.map((c) => (
              <span key={c} className="wc-chip wc-chip--soft">
                {c}
              </span>
            ))}
          </div>
        ) : (
          <Empty>None entered.</Empty>
        )}
      </ContextPanel>

      <ContextPanel title="Parsed faults" count={faults.length || undefined} defaultOpen={faults.length > 0}>
        {faults.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {faults.map((p, i) => (
              <span
                key={`${p.code}-${i}`}
                className={p.severity === "critical" ? "wc-chip wc-chip--crit" : "wc-chip wc-chip--soft"}
                title={p.description}
              >
                {p.code} · {SEV_ABBR[p.severity]}
              </span>
            ))}
          </div>
        ) : (
          <Empty>No fault dump parsed.</Empty>
        )}
      </ContextPanel>

      <ContextPanel title="Pre-arrival briefing" defaultOpen>
        {ticket.pre_arrival_summary ? (
          <p className="wc-symptom" style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>
            {ticket.pre_arrival_summary}
          </p>
        ) : (
          <Empty>Chat with Railio to write the briefing for the tech.</Empty>
        )}
      </ContextPanel>

      <div className="wc-card">
        <DeleteTicketButton ticketId={ticketId} onDeleted={onHandedOff} block />
      </div>
    </>
  );
}
