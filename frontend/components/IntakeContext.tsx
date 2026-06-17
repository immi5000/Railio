"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTicket, patchTicket } from "@/lib/api";
import type { TicketStatus } from "@/lib/contract";
import { formatDate, severityClass, statusLabel, statusPillClass } from "@/lib/format";
import { ContextPanel, Empty } from "./ContextPanel";

/**
 * Dispatcher counterpart to RepairContext. Surfaces what the dispatcher
 * captured (symptoms, codes, parsed faults, pre-arrival briefing) and the
 * hand-off action, so the dispatcher's workflow lives in the same 3-pane shell.
 */
export function IntakeContext({
  ticketId,
  onHandedOff,
}: {
  ticketId: string;
  onHandedOff: () => void;
}) {
  const qc = useQueryClient();
  const { data: ticket } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => getTicket(ticketId),
  });

  const handoffMut = useMutation({
    mutationFn: () => patchTicket(ticketId, { status: "AWAITING_TECH" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      onHandedOff();
    },
  });

  if (!ticket) {
    return (
      <div style={{ padding: "var(--s5)" }}>
        <span className="micro" style={{ color: "var(--muted)" }}>
          Loading intake…
        </span>
      </div>
    );
  }

  const codes = (ticket.initial_error_codes ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const faults = ticket.fault_dump_parsed || [];

  return (
    <div style={{ padding: "var(--s4)" }}>
      <div style={{ marginBottom: "var(--s4)" }}>
        <span className="sect-eyebrow">Intake details</span>
      </div>

      <div
        style={{
          border: "1px solid var(--border)",
          padding: "var(--s4)",
          marginBottom: "var(--s3)",
          background: "var(--pale)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: "var(--s2)",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            {ticket.asset.reporting_mark} {ticket.asset.road_number}
          </div>
          <div style={{ display: "flex", gap: "var(--s1)", alignItems: "center" }}>
            <span className={severityClass(ticket.severity)} style={{ textTransform: "capitalize" }}>
              {ticket.severity}
            </span>
            <span className={statusPillClass(ticket.status as TicketStatus)}>
              {statusLabel(ticket.status as TicketStatus)}
            </span>
          </div>
        </div>
        <div className="micro" style={{ color: "var(--muted)" }}>
          {ticket.asset.unit_model} · opened {formatDate(ticket.opened_at)}
        </div>
      </div>

      <ContextPanel title="Reported symptoms" defaultOpen>
        {ticket.initial_symptoms ? (
          <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>
            {ticket.initial_symptoms}
          </p>
        ) : (
          <Empty>None recorded.</Empty>
        )}
      </ContextPanel>

      <ContextPanel title="Error codes" count={codes.length || undefined} defaultOpen={codes.length > 0}>
        {codes.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s1)" }}>
            {codes.map((c) => (
              <span key={c} className="pill pill-soft">{c}</span>
            ))}
          </div>
        ) : (
          <Empty>None entered.</Empty>
        )}
      </ContextPanel>

      <ContextPanel title="Parsed faults" count={faults.length || undefined} defaultOpen={faults.length > 0}>
        {faults.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s1)" }}>
            {faults.map((p, i) => (
              <span key={`${p.code}-${i}`} className={severityClass(p.severity)} title={p.description}>
                {p.code} · {p.severity}
              </span>
            ))}
          </div>
        ) : (
          <Empty>No fault dump parsed.</Empty>
        )}
      </ContextPanel>

      <ContextPanel title="Pre-arrival briefing" defaultOpen>
        {ticket.pre_arrival_summary ? (
          <p style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", color: "var(--ink-2)" }}>
            {ticket.pre_arrival_summary}
          </p>
        ) : (
          <Empty>Chat with Railio to write the briefing for the tech.</Empty>
        )}
      </ContextPanel>

      {ticket.status === "AWAITING_TECH" && (
        <button
          className="btn btn-super"
          style={{ width: "100%", marginTop: "var(--s2)" }}
          onClick={() => handoffMut.mutate()}
          disabled={handoffMut.isPending}
        >
          {handoffMut.isPending ? "Handing off…" : "Hand off to tech →"}
        </button>
      )}
      {handoffMut.error && (
        <div style={{ color: "#8a1f15", fontSize: 12, marginTop: "var(--s2)" }}>
          {(handoffMut.error as Error).message}
        </div>
      )}
    </div>
  );
}
