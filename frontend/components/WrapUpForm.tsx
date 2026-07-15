"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  finalizeWrapUp,
  getTicket,
  getWrapUpDraft,
  listAllParts,
} from "@/lib/api";
import type { Part, WrapUpDraft } from "@/lib/contract";

// Junk the AI sometimes emits that adds no signal — dropped on autofill.
const NOISE = /^-?\s*(-?\s*)?(no additional notes\.?|n\/?a\.?|none\.?)$/i;

/** One line of a draft, cleaned of leading dashes/markers and whitespace. */
function cleanLine(raw: string): string {
  return raw.replace(/^[-•*\s]+/, "").trim();
}

/**
 * Turn the AI-drafted summary + notes into a single formatted notes string:
 * a "## SUMMARY" section (prose) and a "## NOTES" section (bullet list),
 * dropping the noise lines. This string is what the tech edits and what gets
 * filed — the preview below just renders it.
 *
 * The backend prompt asks the model to split the two sections with a "---"
 * line, but the model often ignores it and returns one blob with literal
 * "SUMMARY:" / "NOTES:" labels inside `draft.summary`. So rather than trust
 * the server-side split, we re-parse: join whatever we got, then carve on the
 * SUMMARY:/NOTES: markers ourselves. This is resilient to either shape.
 */
function draftToNotes(draft?: WrapUpDraft): string {
  if (!draft) return "";

  // Normal path: the backend split the draft into summary + notes. But the
  // model often ignores the "---" separator and returns the whole thing in
  // `summary` with a literal "NOTES:" label mid-text — carve that out here so
  // the labels never leak into the rendered notes. Everything up to the first
  // "NOTES:" is summary; the remainder becomes the notes bullets.
  let summaryRaw = draft.summary || "";
  let notesRaw = draft.notes || "";

  const embedded = summaryRaw.search(/\bnotes\s*:/i);
  if (!notesRaw && embedded >= 0) {
    notesRaw = summaryRaw.slice(embedded);
    summaryRaw = summaryRaw.slice(0, embedded);
  }

  // Strip the leading labels the model leaves in ("SUMMARY:", "NOTES:").
  summaryRaw = summaryRaw.replace(/^\s*summary\s*:\s*/i, "");
  notesRaw = notesRaw.replace(/^\s*notes\s*:\s*/i, "");

  const blocks: string[] = [];

  const summary = summaryRaw
    .split("\n")
    .map(cleanLine)
    .filter((t) => t && !NOISE.test(t));
  if (summary.length) {
    blocks.push("## SUMMARY\n" + summary.join(" "));
  }

  const notes = notesRaw
    .split("\n")
    .map(cleanLine)
    .filter((t) => t && !NOISE.test(t))
    .map((t) => `- ${t}`);
  if (notes.length) {
    blocks.push("## NOTES\n" + notes.join("\n"));
  }

  return blocks.join("\n\n");
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** Render the notes string ("## HEADER" sections, "- " bullets, prose lines)
 *  into the structured HTML the WYSIWYG editor edits directly: heading rows,
 *  real <ul>/<li> bullets, and prose paragraphs — the same formatting the tech
 *  sees while typing. Blocks carry data-block markers so we can serialize the
 *  edited DOM back to a notes string. */
function notesToHtml(value: string): string {
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of value.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("##")) {
      closeList();
      out.push(
        `<h4 class="wrapup-notes-heading" data-block="heading">${esc(
          line.replace(/^#+\s*/, ""),
        )}</h4>`,
      );
    } else if (/^[-•*]\s+/.test(line)) {
      if (!inList) {
        out.push('<ul class="wrapup-notes-list" data-block="list">');
        inList = true;
      }
      out.push(`<li>${esc(cleanLine(line))}</li>`);
    } else {
      closeList();
      out.push(`<p class="wrapup-notes-prose" data-block="prose">${esc(line)}</p>`);
    }
  }
  closeList();
  return out.join("");
}

/** Walk the edited DOM back into the "## HEADER" / "- bullet" notes string
 *  that gets filed. Reads block markers; falls back to plain text for anything
 *  the browser inserted (e.g. a bare <div> on Enter). */
function htmlToNotes(root: HTMLElement): string {
  const lines: string[] = [];
  for (const node of Array.from(root.children)) {
    const el = node as HTMLElement;
    const kind = el.dataset.block;
    const text = (el.textContent || "").trim();
    if (el.tagName === "UL" || kind === "list") {
      for (const li of Array.from(el.querySelectorAll("li"))) {
        const t = (li.textContent || "").trim();
        if (t) lines.push(`- ${t}`);
      }
    } else if (kind === "heading" || el.tagName === "H4") {
      if (text) lines.push(`## ${text}`);
    } else if (text) {
      lines.push(text);
    }
  }
  return lines.join("\n");
}

/**
 * WYSIWYG Tech-notes editor. A single contentEditable region that shows the
 * formatted headings + bullets while you type — no raw "##"/"-" markers. Kept
 * uncontrolled: React seeds the HTML once (and on `resetKey` changes, e.g.
 * autofill) and the browser owns editing after that, so the caret never jumps.
 * Every input serializes the DOM back to a notes string via onChange.
 */
function NotesEditor({
  value,
  onChange,
  resetKey,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  resetKey: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Seed the DOM from `value` only on mount and when resetKey changes (autofill
  // / clear). We deliberately do NOT re-seed on every `value` change — that would
  // fight the caret while typing, since `value` is derived from this same DOM.
  useLayoutEffect(() => {
    if (ref.current) ref.current.innerHTML = notesToHtml(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const empty = !value.trim();

  return (
    <div
      ref={ref}
      className="wrapup-notes wrapup-notes-editor"
      contentEditable
      suppressContentEditableWarning
      data-empty={empty ? "true" : undefined}
      data-placeholder={placeholder}
      role="textbox"
      aria-multiline="true"
      aria-label="Tech notes"
      onInput={() => {
        if (ref.current) onChange(htmlToNotes(ref.current));
      }}
    />
  );
}

/**
 * The repair-record form filed when a tech wraps up a ticket. A single editable
 * Tech notes field (summary + notes merged into bullet points, with autofill
 * from the chat) plus the parts used and the file button. Deliberately carries
 * no page chrome or chat column so it can host inside a desktop drawer or a
 * mobile "Wrap up" tab. Filing writes the record into the unit's corpus and
 * marks the ticket CLOSED, then shows the "Record filed" success state.
 */
export function WrapUpForm({
  ticketId,
  onFiled,
}: {
  ticketId: string;
  onFiled?: () => void;
}) {
  const qc = useQueryClient();
  const router = useRouter();

  const { data: ticket } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => getTicket(ticketId),
  });

  const { data: draft } = useQuery({
    queryKey: ["wrap-up-draft", ticketId],
    queryFn: () => getWrapUpDraft(ticketId),
    staleTime: Infinity,
  });

  const { data: allParts } = useQuery({
    queryKey: ["parts"],
    queryFn: () => listAllParts(),
  });

  const [notes, setNotes] = useState("");
  const [filed, setFiled] = useState(false);
  // Bumped whenever we replace the notes externally (autofill) so the WYSIWYG
  // editor re-seeds its DOM. Typing does NOT bump this — the editor is
  // uncontrolled while the tech edits, so the caret stays put. The field is
  // not seeded on load; it stays empty until "Autofill from chat".
  const [notesReset, setNotesReset] = useState(0);
  const resetNotes = (next: string) => {
    setNotes(next);
    setNotesReset((k) => k + 1);
  };

  // Parts the tech is adding by hand at wrap-up (part_id → qty). Kept separate
  // from ticket.ticket_parts (already recorded) — these decrement inventory
  // when the ticket is filed.
  const [manualParts, setManualParts] = useState<{ part_id: number; qty: number }[]>([]);
  const [partQuery, setPartQuery] = useState("");

  const partsById = new Map((allParts || []).map((p: Part) => [p.id, p]));
  const usedParts = (ticket?.ticket_parts || []).map((tp) => ({
    ...tp,
    part: partsById.get(tp.part_id),
  }));

  const fileMut = useMutation({
    mutationFn: () =>
      finalizeWrapUp(ticketId, {
        // Tech notes is now the single record field; it becomes the corpus entry.
        summary: notes.trim(),
        parts: manualParts.filter((p) => p.qty > 0),
      }),
    onSuccess: () => {
      setFiled(true);
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      // Inventory was drawn down server-side — refresh the parts catalog too.
      qc.invalidateQueries({ queryKey: ["parts"] });
      onFiled?.();
    },
  });

  // Once filed, show the "Record filed" confirmation briefly, then return the
  // tech to the dashboard so the closed ticket drops off their view.
  useEffect(() => {
    if (!filed) return;
    const t = setTimeout(() => router.push("/dashboard"), 1500);
    return () => clearTimeout(t);
  }, [filed, router]);

  // Catalog entries not already picked, filtered by the search box. Capped so a
  // large inventory doesn't render thousands of rows.
  const pickedIds = new Set(manualParts.map((p) => p.part_id));
  const q = partQuery.trim().toLowerCase();
  const partMatches = (allParts || [])
    .filter((p) => !pickedIds.has(p.id))
    .filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.part_number.toLowerCase().includes(q),
    )
    .slice(0, 8);

  const addManualPart = (partId: number) => {
    setManualParts((prev) =>
      prev.some((p) => p.part_id === partId)
        ? prev
        : [...prev, { part_id: partId, qty: 1 }],
    );
    setPartQuery("");
  };

  const setManualQty = (partId: number, qty: number) =>
    setManualParts((prev) =>
      prev.map((p) => (p.part_id === partId ? { ...p, qty } : p)),
    );

  const removeManualPart = (partId: number) =>
    setManualParts((prev) => prev.filter((p) => p.part_id !== partId));

  return (
    <div className="wrapup-form">
      {filed ? (
        <div className="card" style={{ textAlign: "center" }}>
          <span className="pill pill-ok">Record filed</span>
          <p style={{ marginTop: 12, fontSize: 14 }}>
            The repair record is now part of{" "}
            {ticket?.asset.reporting_mark} {ticket?.asset.road_number}&rsquo;s
            history and will surface in future chats for this unit.
          </p>
          <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "center" }}>
            <Link href="/dashboard" className="btn btn-primary btn-sm">
              Back to dashboard
            </Link>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 20 }}>
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
                disabled={!draft || (!draft.summary && !draft.notes)}
                onClick={() => resetNotes(draftToNotes(draft))}
              >
                Autofill from chat
              </button>
            </div>

            <div className="wrapup-notes-preview" style={{ marginTop: 6 }}>
              <NotesEditor
                value={notes}
                onChange={setNotes}
                resetKey={notesReset}
                placeholder="What was wrong, what you did, the outcome, and what to check first next time."
              />
            </div>
          </div>

          <div>
            <label className="label">Parts used</label>

            {/* Already recorded on the ticket (AI suggestions logged in chat). */}
            {usedParts.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                {usedParts.map((u) => (
                  <div
                    key={u.id}
                    className="card-tight"
                    style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}
                  >
                    <span>
                      {u.part ? u.part.name : `Part #${u.part_id}`}
                      {u.part ? (
                        <span style={{ color: "var(--dash-muted)" }}> · {u.part.part_number}</span>
                      ) : null}
                    </span>
                    <span className="pill">×{u.qty}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Manually added parts, with editable quantity. These draw down
                inventory when the ticket is filed. */}
            {manualParts.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                {manualParts.map((mp) => {
                  const part = partsById.get(mp.part_id);
                  return (
                    <div
                      key={mp.part_id}
                      className="card-tight"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        {part ? part.name : `Part #${mp.part_id}`}
                        {part ? (
                          <span style={{ color: "var(--dash-muted)" }}>
                            {" "}· {part.part_number}
                            {typeof part.qty_on_hand === "number" ? (
                              <> · {part.qty_on_hand} on hand</>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                      <input
                        type="number"
                        min={1}
                        className="input"
                        style={{ width: 64, padding: "4px 8px", fontSize: 13 }}
                        value={mp.qty}
                        onChange={(e) =>
                          setManualQty(mp.part_id, Math.max(1, Number(e.target.value) || 1))
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label="Remove part"
                        onClick={() => removeManualPart(mp.part_id)}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {usedParts.length === 0 && manualParts.length === 0 && (
              <p style={{ color: "var(--dash-muted)", fontSize: 13, marginBottom: 8 }}>
                None recorded on this ticket.
              </p>
            )}

            {/* Search inventory to add a part by hand. */}
            <div style={{ position: "relative" }}>
              <input
                type="text"
                className="input"
                style={{ width: "100%", fontSize: 13 }}
                placeholder="Add a part from inventory — search by name or number"
                value={partQuery}
                onChange={(e) => setPartQuery(e.target.value)}
              />
              {partQuery.trim() && (
                <div
                  className="card"
                  style={{
                    position: "absolute",
                    zIndex: 10,
                    top: "100%",
                    left: 0,
                    right: 0,
                    marginTop: 4,
                    padding: 4,
                    maxHeight: 220,
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  {partMatches.length === 0 ? (
                    <p style={{ color: "var(--dash-muted)", fontSize: 13, padding: "6px 8px" }}>
                      No matching parts.
                    </p>
                  ) : (
                    partMatches.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{
                          justifyContent: "space-between",
                          textAlign: "left",
                          width: "100%",
                        }}
                        onClick={() => addManualPart(p.id)}
                      >
                        <span>
                          {p.name}
                          <span style={{ color: "var(--dash-muted)" }}> · {p.part_number}</span>
                        </span>
                        <span style={{ color: "var(--dash-muted)", fontSize: 12 }}>
                          {p.qty_on_hand} on hand
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              paddingTop: 12,
              borderTop: "1px solid var(--dash-line)",
            }}
          >
            {fileMut.error && (
              <span style={{ color: "#c0392b", fontSize: 12 }}>
                {(fileMut.error as Error).message}
              </span>
            )}
            <button
              type="button"
              className="work-cta work-cta-file"
              style={{ width: "100%" }}
              disabled={fileMut.isPending || !notes.trim()}
              onClick={() => fileMut.mutate()}
            >
              {fileMut.isPending ? "Filing…" : "File record & close ticket"}{" "}
              <span className="ico-arr work-cta-file-arr" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
