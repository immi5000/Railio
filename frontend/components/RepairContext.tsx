"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTicket, listParts, fileUrl } from "@/lib/api";
import type { Citation, Part, TicketDetail, TicketStatus } from "@/lib/contract";
import { formatDate, formatDateOnly, severityClass, statusLabel, statusPillClass } from "@/lib/format";
import { CitationDrawer } from "./CitationDrawer";
import { ContextPanel, Empty } from "./ContextPanel";

export function RepairContext({ ticketId }: { ticketId: string }) {
  const { data: ticket } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => getTicket(ticketId),
  });

  const { data: parts } = useQuery({
    queryKey: ["parts", "all"],
    queryFn: () => listParts(),
  });

  const [openChunk, setOpenChunk] = useState<number | null>(null);

  const dedupedCitations: Citation[] = useMemo(() => {
    if (!ticket) return [];
    const seen = new Set<number>();
    const out: Citation[] = [];
    for (const m of ticket.messages) {
      for (const c of m.citations || []) {
        if (!seen.has(c.chunk_id)) {
          seen.add(c.chunk_id);
          out.push(c);
        }
      }
    }
    return out;
  }, [ticket]);

  const allPhotos = useMemo(() => {
    if (!ticket) return [];
    const out: { path: string; mime: string }[] = [];
    for (const m of ticket.messages) {
      for (const a of m.attachments || []) {
        if (a.kind === "image") out.push({ path: a.path, mime: a.mime });
      }
    }
    return out;
  }, [ticket]);

  if (!ticket) {
    return (
      <div style={{ padding: "var(--s5)" }}>
        <span className="micro" style={{ color: "var(--muted)" }}>
          Loading context…
        </span>
      </div>
    );
  }

  // Smart defaults: before work starts, intake info matters most; once the
  // repair is underway, parts/photos/citations are what the tech reaches for.
  const started = ticket.status !== "AWAITING_TECH";
  const faults = ticket.fault_dump_parsed || [];

  return (
    <div style={{ padding: "var(--s4)" }}>
      <div style={{ marginBottom: "var(--s4)" }}>
        <span className="sect-eyebrow">Repair context</span>
      </div>

      <TicketCard ticket={ticket} />
      <UnitInfo ticket={ticket} />

      <ContextPanel title="Parsed faults" count={faults.length || undefined} defaultOpen={!started}>
        {faults.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s1)" }}>
            {faults.map((p, i) => (
              <span
                key={`${p.code}-${i}`}
                className={severityClass(p.severity)}
                title={p.description}
              >
                {p.code} · {p.severity}
              </span>
            ))}
          </div>
        ) : (
          <Empty>No fault dump on file.</Empty>
        )}
      </ContextPanel>

      <ContextPanel title="Pre-arrival briefing" defaultOpen={!started}>
        {ticket.pre_arrival_summary ? (
          <p style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", color: "var(--ink-2)" }}>
            {ticket.pre_arrival_summary}
          </p>
        ) : (
          <Empty>Dispatcher and AI haven&rsquo;t written one yet.</Empty>
        )}
      </ContextPanel>

      <ContextPanel
        title="Parts"
        count={ticket.ticket_parts?.length || undefined}
        defaultOpen={started}
      >
        <SuggestedParts ticket={ticket} parts={parts || []} />
      </ContextPanel>

      <ContextPanel title="Citations" count={dedupedCitations.length || undefined} defaultOpen={started}>
        {dedupedCitations.length === 0 ? (
          <Empty>No citations yet.</Empty>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            {dedupedCitations.map((c) => (
              <button
                key={c.chunk_id}
                className={c.doc_class === "manual" ? "cite cite-manual" : "cite cite-tribal"}
                onClick={() => setOpenChunk(c.chunk_id)}
              >
                {c.doc_class === "manual" ? "📖" : "👤"} {c.source_label}
              </button>
            ))}
          </div>
        )}
      </ContextPanel>

      <ContextPanel title="Photos" count={allPhotos.length || undefined} defaultOpen={started}>
        {allPhotos.length === 0 ? (
          <Empty>No photos sent yet.</Empty>
        ) : (
          <div style={{ display: "flex", gap: "var(--s2)", overflowX: "auto", paddingBottom: "var(--s1)" }}>
            {allPhotos.map((p, i) => (
              <a
                key={`${p.path}-${i}`}
                href={fileUrl(p.path)}
                target="_blank"
                rel="noreferrer"
                style={{
                  flex: "0 0 96px",
                  width: 96,
                  height: 96,
                  border: "1px solid var(--border)",
                  background: "var(--pale)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fileUrl(p.path)}
                  alt="ticket photo"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </a>
            ))}
          </div>
        )}
      </ContextPanel>

      {openChunk != null && (
        <CitationDrawer chunkId={openChunk} onClose={() => setOpenChunk(null)} />
      )}
    </div>
  );
}

function TicketCard({ ticket }: { ticket: TicketDetail }) {
  const [showRaw, setShowRaw] = useState(false);
  const codes = (ticket.initial_error_codes ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const hasRaw = !!ticket.fault_dump_raw;
  return (
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
        <div style={{ fontWeight: 700, fontSize: 14 }} title={ticket.short_id}>
          {ticket.title || "Ticket"}
        </div>
        <div style={{ display: "flex", gap: "var(--s1)", alignItems: "center" }}>
          <span
            className={severityClass(ticket.severity)}
            style={{ textTransform: "capitalize" }}
            title={`Severity: ${ticket.severity}`}
          >
            {ticket.severity}
          </span>
          <span className={statusPillClass(ticket.status as TicketStatus)}>
            {statusLabel(ticket.status as TicketStatus)}
          </span>
        </div>
      </div>
      <div className="micro" style={{ color: "var(--muted)", marginBottom: "var(--s2)" }}>
        Opened {formatDate(ticket.opened_at)}
        {ticket.closed_at && ` · closed ${formatDate(ticket.closed_at)}`}
      </div>

      {codes.length > 0 && (
        <div style={{ marginBottom: "var(--s2)" }}>
          <div className="micro" style={{ marginBottom: "var(--s1)" }}>Initial error codes</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s1)" }}>
            {codes.map((c) => (
              <span key={c} className="pill pill-soft">{c}</span>
            ))}
          </div>
        </div>
      )}

      {ticket.initial_symptoms && (
        <div style={{ marginBottom: hasRaw ? "var(--s2)" : 0 }}>
          <div className="micro" style={{ marginBottom: "var(--s1)" }}>Initial symptoms</div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>
            {ticket.initial_symptoms}
          </div>
        </div>
      )}

      {hasRaw && (
        <div>
          <button
            className="micro"
            onClick={() => setShowRaw((v) => !v)}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--mta)",
              textDecoration: "underline",
            }}
          >
            {showRaw ? "Hide" : "Show"} raw fault dump
          </button>
          {showRaw && (
            <pre
              style={{
                marginTop: "var(--s1)",
                padding: "var(--s2)",
                background: "#0a0a0a",
                color: "#e5e5e5",
                fontSize: 11,
                lineHeight: 1.4,
                overflow: "auto",
                maxHeight: 200,
                whiteSpace: "pre-wrap",
              }}
            >
              {ticket.fault_dump_raw}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function UnitInfo({ ticket }: { ticket: TicketDetail }) {
  const a = ticket.asset;
  return (
    <div style={{ border: "1px solid var(--ink)", padding: "var(--s4)", marginBottom: "var(--s4)" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          borderBottom: "1px solid var(--ink)",
          paddingBottom: "var(--s2)",
          marginBottom: "var(--s3)",
        }}
      >
        <span className="micro">Unit</span>
        <span className="micro" style={{ color: "var(--mta)" }}>{a.unit_model}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.01em" }}>
        {a.reporting_mark} {a.road_number}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "var(--s3)",
          marginTop: "var(--s3)",
          fontSize: 12,
        }}
      >
        <div>
          <div className="micro">In service</div>
          <div>{formatDateOnly(a.in_service_date)}</div>
        </div>
        <div>
          <div className="micro">Last inspection</div>
          <div>{formatDateOnly(a.last_inspection_at)}</div>
        </div>
      </div>
    </div>
  );
}

function SuggestedParts({ ticket, parts }: { ticket: TicketDetail; parts: Part[] }) {
  if (!ticket.ticket_parts || ticket.ticket_parts.length === 0) {
    return <Empty>None yet — Railio adds them as it diagnoses.</Empty>;
  }
  const partsById = new Map(parts.map((p) => [p.id, p]));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {ticket.ticket_parts.map((tp) => {
        const p = partsById.get(tp.part_id);
        return (
          <div
            key={tp.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: "var(--s2)",
              padding: "var(--s2) 0",
              borderBottom: "1px solid var(--pale)",
              fontSize: 13,
            }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>{p?.name || "Unknown part"}</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                {p?.part_number || "—"} · Bin {p?.bin_location || "?"} · qty {p?.qty_on_hand ?? "?"}
              </div>
            </div>
            <span className="micro" style={{ color: "var(--muted)", alignSelf: "center" }}>
              {tp.added_via === "ai_suggestion" ? "AI" : "manual"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
