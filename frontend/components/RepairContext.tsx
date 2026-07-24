"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTicket, listAllParts, fileUrl } from "@/lib/api";
import type { Citation, ParsedFault, Part, Severity, TicketDetail, TicketPart } from "@/lib/contract";
import { formatDateOnly } from "@/lib/format";
import { mostUrgent, oosDays, STATE_COLOR } from "@/lib/inspections";
import { useTicketParts, type TicketPartsController } from "@/lib/useTicketParts";
import { CitationDrawer } from "./CitationDrawer";
import { ContextPanel, Empty } from "./ContextPanel";
import { PartAllocatorModal } from "./PartAllocatorModal";

const SEV_ABBR: Record<Severity, string> = {
  critical: "crit",
  major: "maj",
  minor: "min",
};

export function RepairContext({ ticketId }: { ticketId: string }) {
  const { data: ticket } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => getTicket(ticketId),
  });

  const { data: parts } = useQuery({
    queryKey: ["parts", "all"],
    queryFn: () => listAllParts(),
  });

  const partsCtl = useTicketParts(ticketId);
  const [pickerPart, setPickerPart] = useState<Part | null>(null);

  const [openChunk, setOpenChunk] = useState<number | null>(null);

  const tribalCitations: Citation[] = useMemo(() => {
    if (!ticket) return [];
    const seen = new Set<number>();
    const out: Citation[] = [];
    for (const m of ticket.messages) {
      for (const c of m.citations || []) {
        if (c.doc_class === "tribal_knowledge" && !seen.has(c.chunk_id)) {
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
      <div className="wc-card">
        <span className="wc-sub loading-dots">Loading context</span>
      </div>
    );
  }

  const started =
    ticket.status !== "AWAITING_HANDOFF" && ticket.status !== "AWAITING_TECH";
  const faults = ticket.fault_dump_parsed || [];
  const firstCode =
    faults[0]?.code ||
    (ticket.initial_error_codes ?? "").split(",").map((c) => c.trim()).filter(Boolean)[0] ||
    null;

  return (
    <>
      <UnitIntakeCard ticket={ticket} errorCode={firstCode} />

      <ContextPanel
        title="Parts to bring"
        count={ticket.ticket_parts?.length || undefined}
        defaultOpen={started}
      >
        <PartsToBring ticket={ticket} parts={parts || []} unitModel={ticket.asset.unit_model} firstCode={firstCode} controller={partsCtl} onEdit={setPickerPart} />
      </ContextPanel>

      <ContextPanel
        title="Faults & senior-tech notes"
        defaultOpen={started}
      >
        <FaultsAndNotes
          faults={faults}
          tribal={tribalCitations}
          onOpenChunk={setOpenChunk}
        />
      </ContextPanel>

      <ContextPanel title="Parsed faults" count={faults.length || undefined} defaultOpen={false}>
        {faults.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {faults.map((p, i) => (
              <FaultChip key={`${p.code}-${i}`} fault={p} />
            ))}
          </div>
        ) : (
          <Empty>No fault dump on file.</Empty>
        )}
      </ContextPanel>

      <ContextPanel title="Photos" count={allPhotos.length || undefined} defaultOpen={false}>
        {allPhotos.length === 0 ? (
          <Empty>No photos sent yet.</Empty>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {allPhotos
              .filter((p) => fileUrl(p.path))
              .map((p, i) => (
                <a
                  key={`${p.path}-${i}`}
                  href={fileUrl(p.path)}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 10,
                    overflow: "hidden",
                    border: "1px solid var(--dash-border)",
                    background: "var(--dash-bg)",
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

      {pickerPart && (
        <PartAllocatorModal
          part={pickerPart}
          controller={partsCtl}
          onClose={() => setPickerPart(null)}
        />
      )}
    </>
  );
}

function UnitIntakeCard({
  ticket,
  errorCode,
}: {
  ticket: TicketDetail;
  errorCode: string | null;
}) {
  const a = ticket.asset;
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div className="wc-card" style={{ display: "flex", flexDirection: "column", gap: 17 }}>
      <div className="wc-head">
        <span className="wc-title">Unit &amp; intake</span>
        <span className="wc-link">{a.unit_model}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="wc-unit">
          {a.reporting_mark} {a.road_number}
        </div>

        <div className="wc-meta-row">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="wc-meta-label">IN SERVICE</span>
            <span className="wc-meta-value">{formatDateOnly(a.in_service_date)}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="wc-meta-label">NEXT DUE</span>
            {(() => {
              const down = oosDays(a);
              if (down !== null) {
                return (
                  <span className="wc-meta-value" style={{ color: "var(--dash-danger)" }}>
                    OOS · down {down}d
                  </span>
                );
              }
              const urgent = mostUrgent(a);
              return (
                <span className="wc-meta-value" style={{ color: STATE_COLOR[urgent.state] }}>
                  {urgent.nextDue
                    ? `${urgent.label} · ${formatDateOnly(urgent.nextDue)}`
                    : "—"}
                </span>
              );
            })()}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <span className="wc-meta-label">ERROR CODE</span>
            <span className="wc-meta-value">{errorCode || "—"}</span>
          </div>
        </div>

        <hr className="wc-divider" />

        <div className="wc-symptom">
          <span style={{ color: "var(--dash-muted)" }}>Symptoms: </span>
          {ticket.initial_symptoms || "—"}
        </div>

        {ticket.fault_dump_raw && (
          <div>
            <button
              className="wc-sub"
              onClick={() => setShowRaw((v) => !v)}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--dash-link)",
                textDecoration: "underline",
              }}
            >
              {showRaw ? "Hide" : "Show"} raw fault dump
            </button>
            {showRaw && (
              <pre
                style={{
                  marginTop: 8,
                  padding: 12,
                  borderRadius: 8,
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
    </div>
  );
}

// "2 @ BIN-A · 1 @ BIN-B" from the per-bin allocations, or a plain bin fallback.
function allocationSummary(tp: TicketPart, fallbackBin: string | null): string {
  const allocs = (tp.allocations ?? []).filter((a) => a.qty > 0);
  if (allocs.length) return allocs.map((a) => `${a.qty} @ ${a.location}`).join(" · ");
  return fallbackBin || "Bin ?";
}

function PartsToBring({
  ticket,
  parts,
  unitModel,
  firstCode,
  controller,
  onEdit,
}: {
  ticket: TicketDetail;
  parts: Part[];
  unitModel: string;
  firstCode: string | null;
  controller: TicketPartsController;
  onEdit: (part: Part) => void;
}) {
  if (!ticket.ticket_parts || ticket.ticket_parts.length === 0) {
    return <Empty>None yet — Railio adds them as it diagnoses.</Empty>;
  }
  const partsById = new Map(parts.map((p) => [p.id, p]));
  const subtitle = firstCode
    ? `Relevant to fault ${firstCode} · ${unitModel}`
    : `Suggested for ${unitModel}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="wc-sub">{subtitle}</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {ticket.ticket_parts.map((tp) => {
          const p = partsById.get(tp.part_id);
          const insufficient = p != null && p.qty_on_hand < tp.qty;
          // Tap the whole row to open the per-bin allocator (needs the catalog
          // part for its locations); read-only when there's no catalog match.
          const editable = controller.enabled && p != null;
          return (
            <div
              key={tp.id}
              className="wc-part"
              onClick={editable ? () => onEdit(p as Part) : undefined}
              style={editable ? { cursor: "pointer" } : undefined}
              title={editable ? "Edit quantity / bins" : undefined}
            >
              <div style={{ minWidth: 0 }}>
                <div className="wc-part-name">{p?.name || "Unknown part"}</div>
                <div className="wc-part-meta">
                  {p?.part_number || "—"} · {allocationSummary(tp, p?.bin_location ?? null)}
                </div>
              </div>
              <div className="wc-part-right">
                {insufficient && <span className="wc-chip wc-chip--blue">Insufficient</span>}
                <span className="wc-qty">x{tp.qty}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FaultsAndNotes({
  faults,
  tribal,
  onOpenChunk,
}: {
  faults: ParsedFault[];
  tribal: Citation[];
  onOpenChunk: (id: number) => void;
}) {
  if (faults.length === 0 && tribal.length === 0) {
    return <Empty>No faults parsed and no senior-tech notes yet.</Empty>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
      {faults.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {faults.map((p, i) => (
            <FaultChip key={`${p.code}-${i}`} fault={p} />
          ))}
        </div>
      )}
      {tribal.length > 0 && (
        <>
          {faults.length > 0 && <hr className="wc-divider" />}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {tribal.map((c) => (
              <button
                key={c.chunk_id}
                className="wc-chip wc-chip--blue"
                onClick={() => onOpenChunk(c.chunk_id)}
                style={{ cursor: "pointer", border: "none" }}
                title={c.source_label}
              >
                {c.source_label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FaultChip({ fault }: { fault: ParsedFault }) {
  const cls =
    fault.severity === "critical" ? "wc-chip wc-chip--crit" : "wc-chip wc-chip--soft";
  return (
    <span className={cls} title={fault.description}>
      {fault.code} · {SEV_ABBR[fault.severity]}
    </span>
  );
}
