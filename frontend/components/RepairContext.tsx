"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTicket, listForms, listParts, fileUrl } from "@/lib/api";
import type { Citation, Form, Part, TicketDetail, TicketStatus } from "@/lib/contract";
import { formatDate, formatDateOnly, severityClass, statusLabel, statusPillClass } from "@/lib/format";
import { CitationDrawer } from "./CitationDrawer";
import { useState } from "react";

export function RepairContext({ ticketId }: { ticketId: number }) {
  const { data: ticket } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => getTicket(ticketId),
  });

  const { data: forms } = useQuery({
    queryKey: ["forms", ticketId],
    queryFn: () => listForms(ticketId),
  });

  const { data: parts } = useQuery({
    queryKey: ["parts", "all"],
    queryFn: () => listParts(),
  });

  const [openChunk, setOpenChunk] = useState<number | null>(null);

  const formCount = useFormReadyCount(forms);

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
      <aside style={skeletonStyle}>
        <span className="micro" style={{ color: "var(--muted)" }}>
          Loading context…
        </span>
      </aside>
    );
  }

  return (
    <aside
      style={{
        height: "100%",
        overflowY: "auto",
        background: "#fff",
        borderLeft: "1px solid var(--border)",
        padding: 24,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <span className="sect-eyebrow">Repair context</span>
        <Link
          href={`/tech/ticket/${ticketId}/forms`}
          className="pill pill-blue"
          style={{ textDecoration: "none" }}
        >
          Forms ({formCount}/2)
        </Link>
      </div>

      <TicketCard ticket={ticket} />

      <UnitInfo ticket={ticket} />

      <Section title="Parsed faults">
        {ticket.fault_dump_parsed && ticket.fault_dump_parsed.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ticket.fault_dump_parsed.map((p, i) => (
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
      </Section>

      <Section title="Pre-arrival summary">
        {ticket.pre_arrival_summary ? (
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              color: "var(--ink-2)",
            }}
          >
            {ticket.pre_arrival_summary}
          </p>
        ) : (
          <Empty>Dispatcher and AI haven&rsquo;t written one yet.</Empty>
        )}
      </Section>

      <Section title="Suggested parts">
        <SuggestedParts
          ticket={ticket}
          parts={parts || []}
          ticketId={ticketId}
        />
      </Section>

      <Section title="Cited chunks">
        {dedupedCitations.length === 0 ? (
          <Empty>No citations yet.</Empty>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            {dedupedCitations.map((c) => (
              <button
                key={c.chunk_id}
                className={
                  c.doc_class === "manual"
                    ? "cite cite-manual"
                    : "cite cite-tribal"
                }
                onClick={() => setOpenChunk(c.chunk_id)}
              >
                {c.doc_class === "manual" ? "📖" : "👤"} {c.source_label}
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Photos">
        {allPhotos.length === 0 ? (
          <Empty>No photos sent yet.</Empty>
        ) : (
          <div
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              paddingBottom: 4,
            }}
          >
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
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              </a>
            ))}
          </div>
        )}
      </Section>

      {openChunk != null && (
        <CitationDrawer
          chunkId={openChunk}
          onClose={() => setOpenChunk(null)}
        />
      )}
    </aside>
  );
}

const skeletonStyle: React.CSSProperties = {
  height: "100%",
  borderLeft: "1px solid var(--border)",
  padding: 24,
  background: "#fff",
};

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
        padding: 16,
        marginBottom: 16,
        background: "var(--pale)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 8,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 14 }}>Ticket #{ticket.id}</div>
        <span className={statusPillClass(ticket.status as TicketStatus)}>
          {statusLabel(ticket.status as TicketStatus)}
        </span>
      </div>
      <div className="micro" style={{ color: "var(--muted)", marginBottom: 8 }}>
        Opened {formatDate(ticket.opened_at)}
        {ticket.closed_at && ` · closed ${formatDate(ticket.closed_at)}`}
      </div>

      {codes.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div className="micro" style={{ marginBottom: 4 }}>
            Initial error codes
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {codes.map((c) => (
              <span key={c} className="pill pill-soft">
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {ticket.initial_symptoms && (
        <div style={{ marginBottom: hasRaw ? 8 : 0 }}>
          <div className="micro" style={{ marginBottom: 4 }}>
            Initial symptoms
          </div>
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--ink-2)",
              whiteSpace: "pre-wrap",
            }}
          >
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
                marginTop: 6,
                padding: 8,
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
    <div
      style={{
        border: "1px solid var(--ink)",
        padding: 16,
        marginBottom: 24,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          borderBottom: "1px solid var(--ink)",
          paddingBottom: 8,
          marginBottom: 12,
        }}
      >
        <span className="micro">Unit</span>
        <span className="micro" style={{ color: "var(--mta)" }}>
          {a.unit_model}
        </span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.01em" }}>
        {a.reporting_mark} {a.road_number}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginTop: 12,
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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h4
        className="h4"
        style={{
          fontSize: 13,
          letterSpacing: "0.04em",
          marginBottom: 8,
          paddingBottom: 6,
          borderBottom: "1px solid var(--pale)",
        }}
      >
        {title}
      </h4>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 13, color: "var(--muted)" }}>{children}</span>
  );
}

function SuggestedParts({
  ticket,
  parts,
  ticketId,
}: {
  ticket: TicketDetail;
  parts: Part[];
  ticketId: number;
}) {
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
              gap: 8,
              padding: "8px 0",
              borderBottom: "1px solid var(--pale)",
              fontSize: 13,
            }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>{p?.name || "Unknown part"}</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                {p?.part_number || "—"} · Bin {p?.bin_location || "?"} · qty{" "}
                {p?.qty_on_hand ?? "?"}
              </div>
            </div>
            <span
              className="micro"
              style={{ color: "var(--muted)", alignSelf: "center" }}
            >
              {tp.added_via === "ai_suggestion" ? "AI" : "manual"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function useFormReadyCount(forms: Form[] | undefined): number {
  if (!forms) return 0;
  let count = 0;
  for (const f of forms) {
    if (hasMeaningfulPayload(f)) count++;
  }
  return count;
}

function hasMeaningfulPayload(f: Form): boolean {
  // Heuristic: any non-empty array / string outside of pre-fill identity fields signals readiness.
  switch (f.form_type) {
    case "F6180_49A":
      return (
        (f.payload.defects?.length ?? 0) > 0 ||
        (f.payload.repairs?.length ?? 0) > 0 ||
        f.payload.air_brake_test != null ||
        f.payload.out_of_service ||
        !!f.payload.signature
      );
    case "DAILY_INSPECTION_229_21":
      return (
        (f.payload.items?.some((it) => it.result !== "na") ?? false) ||
        (f.payload.exceptions?.length ?? 0) > 0 ||
        !!f.payload.signature
      );
  }
}
