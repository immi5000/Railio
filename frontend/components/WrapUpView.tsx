"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  finalizeWrapUp,
  getTicket,
  getWrapUpDraft,
  listParts,
} from "@/lib/api";
import { ChatPane } from "./ChatPane";
import type { Part } from "@/lib/contract";

/**
 * Post-ticket wrap-up. Reached after the tech closes a ticket — a deliberately
 * separate page so it reads as "the repair is done, this is the record being
 * filed." Shows an AI summary + editable tech notes (with autofill), the parts
 * used, and the date/time, with the chat still visible alongside. Filing writes
 * the record into the unit's corpus and marks the ticket CLOSED.
 */
export function WrapUpView({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const qc = useQueryClient();

  const { data: ticket } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => getTicket(ticketId),
  });

  const { data: draft, isLoading: draftLoading } = useQuery({
    queryKey: ["wrap-up-draft", ticketId],
    queryFn: () => getWrapUpDraft(ticketId),
    staleTime: Infinity,
  });

  const { data: allParts } = useQuery({
    queryKey: ["parts"],
    queryFn: () => listParts(),
  });

  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [filed, setFiled] = useState(false);

  // Seed the editable fields once the AI draft arrives.
  useEffect(() => {
    if (draft) {
      setSummary((s) => s || draft.summary || "");
      setNotes((n) => n || (draft.notes && draft.notes !== "- No additional notes." ? draft.notes : ""));
    }
  }, [draft]);

  const partsById = new Map((allParts || []).map((p: Part) => [p.id, p]));
  const usedParts = (ticket?.ticket_parts || []).map((tp) => ({
    ...tp,
    part: partsById.get(tp.part_id),
  }));

  const fileMut = useMutation({
    mutationFn: () =>
      finalizeWrapUp(ticketId, {
        summary: summary.trim(),
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      setFiled(true);
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });

  const now = new Date();
  const stamp = now.toLocaleString();

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
        <Link href="/work" className="micro" style={{ color: "var(--muted)" }}>
          ← Back to queue
        </Link>
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
          <h1 className="h2">Wrap up · {ticket?.title || `Ticket ${ticketId}`}</h1>
          <span className="pill pill-ok">Repair complete</span>
        </div>
        {ticket && (
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
            {ticket.asset.reporting_mark} {ticket.asset.road_number} ·{" "}
            {ticket.asset.unit_model} · filed {stamp}
          </p>
        )}
      </div>

      <div
        className="wrap split-2col"
        style={{
          flex: 1,
          minHeight: 0,
          gridTemplateColumns: "1.1fr .9fr",
          gap: 24,
          paddingBottom: 16,
        }}
      >
        {/* Left: the record being filed */}
        <div style={{ minHeight: 0, overflow: "auto" }} className="scroll-chat">
          {filed ? (
            <div className="card" style={{ textAlign: "center" }}>
              <span className="pill pill-ok">Record filed</span>
              <p style={{ marginTop: 12, fontSize: 14 }}>
                The repair record is now part of{" "}
                {ticket?.asset.reporting_mark} {ticket?.asset.road_number}&rsquo;s
                history and will surface in future chats for this unit.
              </p>
              <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "center" }}>
                <Link href="/work" className="btn btn-primary btn-sm">
                  Back to queue
                </Link>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 20 }}>
              <div>
                <label className="label">Repair summary</label>
                <textarea
                  className="textarea"
                  style={{ minHeight: 120 }}
                  value={summary}
                  placeholder={draftLoading ? "Drafting from the chat…" : "What was wrong, what you did, the outcome."}
                  onChange={(e) => setSummary(e.target.value)}
                />
              </div>

              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <label className="label" style={{ marginBottom: 0 }}>
                    Tech notes
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!draft?.notes}
                    onClick={() =>
                      setNotes(
                        draft?.notes && draft.notes !== "- No additional notes."
                          ? draft.notes
                          : "",
                      )
                    }
                  >
                    Autofill from chat
                  </button>
                </div>
                <textarea
                  className="textarea"
                  style={{ minHeight: 100, marginTop: 6 }}
                  value={notes}
                  placeholder="Gotchas, what to check first next time. Optional."
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div>
                <label className="label">Parts used</label>
                {usedParts.length === 0 ? (
                  <p style={{ color: "var(--muted)", fontSize: 13 }}>
                    None recorded on this ticket.
                  </p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {usedParts.map((u) => (
                      <div
                        key={u.id}
                        className="card-tight"
                        style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}
                      >
                        <span>
                          {u.part ? u.part.name : `Part #${u.part_id}`}
                          {u.part ? (
                            <span style={{ color: "var(--muted)" }}> · {u.part.part_number}</span>
                          ) : null}
                        </span>
                        <span className="pill">×{u.qty}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  paddingTop: 8,
                  borderTop: "1px solid var(--pale)",
                }}
              >
                <button
                  className="btn btn-super"
                  disabled={fileMut.isPending || !summary.trim()}
                  onClick={() => fileMut.mutate()}
                >
                  {fileMut.isPending ? "Filing…" : "File record & close ticket"}{" "}
                  <span className="arr">→</span>
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => router.push(`/tech/ticket/${ticketId}`)}
                  disabled={fileMut.isPending}
                >
                  Back to repair
                </button>
                {fileMut.error && (
                  <span style={{ color: "#8a1f15", fontSize: 12 }}>
                    {(fileMut.error as Error).message}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: chat still available */}
        <div style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
          <span className="sect-eyebrow" style={{ marginBottom: 8 }}>
            Repair thread
          </span>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ChatPane
              ticketId={ticketId}
              role="tech"
              emptyHint="The repair conversation for reference."
            />
          </div>
        </div>
      </div>
    </section>
  );
}
