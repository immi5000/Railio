"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  exportForm,
  fileUrl,
  getTicket,
  listForms,
  patchForm,
} from "@/lib/api";
import type {
  DailyInspection_229_21,
  F6180_49A,
  Form,
  FormType,
  Message,
} from "@/lib/contract";

const TAB_ORDER: { type: FormType; label: string }[] = [
  { type: "DAILY_INSPECTION_229_21", label: "Daily Inspection" },
  { type: "F6180_49A", label: "F6180.49A" },
];

export function FormsTab({ ticketId }: { ticketId: number }) {
  const params = useSearchParams();
  const initialTab = (params.get("tab") as FormType) || "DAILY_INSPECTION_229_21";
  const [tab, setTab] = useState<FormType>(initialTab);

  const { data: forms } = useQuery({
    queryKey: ["forms", ticketId],
    queryFn: () => listForms(ticketId),
    refetchInterval: 4000,
  });
  const { data: ticket } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => getTicket(ticketId),
  });

  const messages: Message[] = ticket?.messages || [];
  const messagesById = useMemo(() => {
    const m = new Map<number, Message>();
    for (const x of messages) m.set(x.id, x);
    return m;
  }, [messages]);

  const current = forms?.find((f) => f.form_type === tab);

  return (
    <section
      style={{ padding: "24px 0 96px", minHeight: "calc(100vh - 56px)" }}
    >
      <div className="wrap">
        <Link
          href={`/tech/ticket/${ticketId}`}
          className="micro"
          style={{ color: "var(--muted)" }}
        >
          ← Back to ticket
        </Link>
        <h1 className="h2" style={{ margin: "4px 0 16px" }}>
          Forms · Ticket #{ticketId}
        </h1>

        <div
          role="tablist"
          style={{
            display: "flex",
            borderBottom: "1px solid var(--ink)",
            marginBottom: 24,
            flexWrap: "wrap",
          }}
        >
          {TAB_ORDER.map((t) => {
            const active = tab === t.type;
            return (
              <button
                key={t.type}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.type)}
                style={{
                  appearance: "none",
                  background: active ? "#000" : "#fff",
                  color: active ? "#fff" : "#000",
                  border: 0,
                  padding: "12px 20px",
                  fontSize: 13,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  cursor: "pointer",
                  borderRight: "1px solid var(--ink)",
                  fontFamily: "inherit",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {!current ? (
          <div className="card" style={{ color: "var(--muted)" }}>
            <span className="micro">Loading form…</span>
          </div>
        ) : (
          <FormEditor
            ticketId={ticketId}
            form={current}
            messagesById={messagesById}
          />
        )}
      </div>
    </section>
  );
}

function FormEditor({
  ticketId,
  form,
  messagesById,
}: {
  ticketId: number;
  form: Form;
  messagesById: Map<number, Message>;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, unknown>>(
    form.payload as unknown as Record<string, unknown>,
  );
  const prevPayloadRef = useRef<string>(JSON.stringify(form.payload));

  // When the server-side payload changes (SSE form_updated → cache invalidation),
  // detect changed paths and flash them briefly.
  const [flashPaths, setFlashPaths] = useState<Set<string>>(new Set());
  useEffect(() => {
    const next = JSON.stringify(form.payload);
    if (next !== prevPayloadRef.current) {
      const before = JSON.parse(prevPayloadRef.current);
      const after = form.payload;
      const changed = diffPaths(before, after);
      prevPayloadRef.current = next;
      setDraft(form.payload as unknown as Record<string, unknown>);
      setFlashPaths(new Set(changed));
      const t = setTimeout(() => setFlashPaths(new Set()), 1600);
      return () => clearTimeout(t);
    }
  }, [form.payload]);

  const saveMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      patchForm(ticketId, form.form_type, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forms", ticketId] }),
  });

  const exportMut = useMutation({
    mutationFn: () => exportForm(ticketId, form.form_type),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["forms", ticketId] });
      window.open(fileUrl(res.pdf_path), "_blank");
    },
  });

  const set = (path: string, value: unknown) =>
    setDraft((d) => setPath(d, path, value));

  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <span className="sect-eyebrow">{labelForType(form.form_type)}</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span className="pill">{form.status}</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => saveMut.mutate(draft)}
            disabled={saveMut.isPending}
          >
            {saveMut.isPending ? "Saving…" : "Save"}
          </button>
          <button
            className="btn btn-super btn-sm"
            onClick={() => exportMut.mutate()}
            disabled={exportMut.isPending}
          >
            {exportMut.isPending ? "Rendering…" : "Export PDF"}
          </button>
          {form.pdf_path && (
            <a
              href={fileUrl(form.pdf_path)}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost btn-sm"
            >
              Open last PDF
            </a>
          )}
        </div>
      </div>

      {saveMut.error && (
        <div style={{ color: "#8a1f15", marginBottom: 12 }}>
          {(saveMut.error as Error).message}
        </div>
      )}

      <div style={{ display: "grid", gap: 0 }}>
        {form.form_type === "DAILY_INSPECTION_229_21" && (
          <DailyInspectionForm
            value={draft as unknown as DailyInspection_229_21}
            set={set}
            flash={flashPaths}
          />
        )}
        {form.form_type === "F6180_49A" && (
          <F6180_49A_Form
            value={draft as unknown as F6180_49A}
            set={set}
            flash={flashPaths}
          />
        )}
      </div>

      <ProvenanceFooter form={form} messagesById={messagesById} />
    </div>
  );
}

// ====== Field primitives ======

function FieldRow({
  label,
  path,
  flash,
  children,
}: {
  label: string;
  path: string;
  flash: Set<string>;
  children: React.ReactNode;
}) {
  const flashing = flash.has(path);
  return (
    <div
      className={`form-field-row ${flashing ? "field-flash" : ""}`.trim()}
      style={{
        display: "grid",
        gridTemplateColumns: "180px 1fr",
        gap: 16,
        padding: "12px 0",
        borderBottom: "1px solid var(--pale)",
        alignItems: "center",
      }}
    >
      <label className="label" style={{ margin: 0 }}>
        {label}
      </label>
      <div>{children}</div>
    </div>
  );
}

function TextField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      className="input"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        gap: 8,
        alignItems: "center",
        fontSize: 14,
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

// ====== Form-specific renderers ======

function DailyInspectionForm({
  value,
  set,
  flash,
}: {
  value: DailyInspection_229_21;
  set: (path: string, v: unknown) => void;
  flash: Set<string>;
}) {
  const items = value.items || [];
  return (
    <>
      <FieldRow label="Inspector" path="inspector_name" flash={flash}>
        <TextField
          value={value.inspector_name || ""}
          onChange={(v) => set("inspector_name", v)}
        />
      </FieldRow>
      <FieldRow label="Inspected at" path="inspected_at" flash={flash}>
        <TextField
          value={value.inspected_at || ""}
          onChange={(v) => set("inspected_at", v)}
        />
      </FieldRow>
      <FieldRow label="Exceptions" path="exceptions" flash={flash}>
        <textarea
          className="textarea"
          value={(value.exceptions || []).join("\n")}
          onChange={(e) =>
            set(
              "exceptions",
              e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      </FieldRow>
      <div style={{ paddingTop: 16 }}>
        <div className="micro" style={{ marginBottom: 8 }}>
          Inspection items
        </div>
        {items.length === 0 && (
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            None yet — Railio adds them as inspection points are checked.
          </span>
        )}
        {items.map((it, i) => {
          const flashing = flash.has(`items.${i}`);
          return (
            <div
              key={i}
              className={`form-item-row ${flashing ? "field-flash" : ""}`.trim()}
              style={{
                display: "grid",
                gridTemplateColumns: "120px 1fr 100px 1fr 0.4fr",
                gap: 8,
                padding: "8px 0",
                borderBottom: "1px solid var(--pale)",
                alignItems: "center",
              }}
            >
              <input
                className="input"
                value={it.code || ""}
                onChange={(e) => set(`items.${i}.code`, e.target.value)}
                placeholder="Code"
              />
              <input
                className="input"
                value={it.label || ""}
                onChange={(e) => set(`items.${i}.label`, e.target.value)}
                placeholder="Item label"
              />
              <select
                className="select"
                value={it.result || "na"}
                onChange={(e) => set(`items.${i}.result`, e.target.value)}
              >
                <option value="pass">pass</option>
                <option value="fail">fail</option>
                <option value="na">n/a</option>
              </select>
              <input
                className="input"
                value={it.note || ""}
                onChange={(e) => set(`items.${i}.note`, e.target.value)}
                placeholder="Note"
              />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  set(
                    "items",
                    items.filter((_, j) => j !== i),
                  )
                }
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 8 }}
          onClick={() =>
            set("items", [
              ...items,
              { code: "", label: "", result: "na" as const, note: "" },
            ])
          }
        >
          + Add item
        </button>
      </div>
    </>
  );
}

function F6180_49A_Form({
  value,
  set,
  flash,
}: {
  value: F6180_49A;
  set: (path: string, v: unknown) => void;
  flash: Set<string>;
}) {
  const defects = value.defects || [];
  const repairs = value.repairs || [];
  return (
    <>
      <FieldRow label="Reporting mark" path="reporting_mark" flash={flash}>
        <TextField
          value={value.reporting_mark || ""}
          onChange={(v) => set("reporting_mark", v)}
        />
      </FieldRow>
      <FieldRow label="Road number" path="road_number" flash={flash}>
        <TextField
          value={value.road_number || ""}
          onChange={(v) => set("road_number", v)}
        />
      </FieldRow>
      <FieldRow label="Inspection date" path="inspection_date" flash={flash}>
        <TextField
          value={value.inspection_date || ""}
          onChange={(v) => set("inspection_date", v)}
        />
      </FieldRow>
      <FieldRow label="Inspector" path="inspector_name" flash={flash}>
        <TextField
          value={value.inspector_name || ""}
          onChange={(v) => set("inspector_name", v)}
        />
      </FieldRow>
      <FieldRow label="Out of service" path="out_of_service" flash={flash}>
        <Checkbox
          checked={!!value.out_of_service}
          onChange={(v) => set("out_of_service", v)}
          label="Locomotive out of service"
        />
      </FieldRow>

      <div style={{ paddingTop: 16 }}>
        <div className="micro" style={{ marginBottom: 8 }}>
          Defects
        </div>
        {defects.length === 0 && (
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            None recorded.
          </span>
        )}
        {defects.map((d, i) => {
          const flashing = flash.has(`defects.${i}`);
          return (
            <div
              key={i}
              className={`form-item-row ${flashing ? "field-flash" : ""}`.trim()}
              style={{
                display: "grid",
                gridTemplateColumns: "120px 1.6fr 1fr 120px 0.4fr",
                gap: 8,
                padding: "8px 0",
                borderBottom: "1px solid var(--pale)",
              }}
            >
              <input
                className="input"
                value={d.fra_part || ""}
                onChange={(e) => set(`defects.${i}.fra_part`, e.target.value)}
                placeholder="FRA Part"
              />
              <input
                className="input"
                value={d.description || ""}
                onChange={(e) =>
                  set(`defects.${i}.description`, e.target.value)
                }
                placeholder="Description"
              />
              <input
                className="input"
                value={d.location || ""}
                onChange={(e) => set(`defects.${i}.location`, e.target.value)}
                placeholder="Location"
              />
              <select
                className="select"
                value={d.severity || "minor"}
                onChange={(e) => set(`defects.${i}.severity`, e.target.value)}
              >
                <option value="minor">minor</option>
                <option value="major">major</option>
                <option value="critical">critical</option>
              </select>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  set(
                    "defects",
                    defects.filter((_, j) => j !== i),
                  )
                }
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 8 }}
          onClick={() =>
            set("defects", [
              ...defects,
              {
                fra_part: "",
                description: "",
                location: "",
                severity: "minor" as const,
              },
            ])
          }
        >
          + Add defect
        </button>
      </div>

      <div style={{ paddingTop: 16 }}>
        <div className="micro" style={{ marginBottom: 8 }}>
          Repairs
        </div>
        {repairs.map((r, i) => {
          const flashing = flash.has(`repairs.${i}`);
          return (
            <div
              key={i}
              className={`form-item-row ${flashing ? "field-flash" : ""}`.trim()}
              style={{
                display: "grid",
                gridTemplateColumns: "1.6fr 1fr 1fr 0.4fr",
                gap: 8,
                padding: "8px 0",
                borderBottom: "1px solid var(--pale)",
              }}
            >
              <input
                className="input"
                value={r.description || ""}
                onChange={(e) =>
                  set(`repairs.${i}.description`, e.target.value)
                }
                placeholder="Description"
              />
              <input
                className="input"
                value={(r.parts_replaced || []).join(", ")}
                onChange={(e) =>
                  set(
                    `repairs.${i}.parts_replaced`,
                    e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
                placeholder="Parts replaced"
              />
              <input
                className="input"
                value={r.completed_at || ""}
                onChange={(e) =>
                  set(`repairs.${i}.completed_at`, e.target.value)
                }
                placeholder="Completed at"
              />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  set(
                    "repairs",
                    repairs.filter((_, j) => j !== i),
                  )
                }
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 8 }}
          onClick={() =>
            set("repairs", [
              ...repairs,
              { description: "", parts_replaced: [], completed_at: "" },
            ])
          }
        >
          + Add repair
        </button>
      </div>
    </>
  );
}

// ====== Provenance footer ======

function ProvenanceFooter({
  form,
  messagesById,
}: {
  form: Form;
  messagesById: Map<number, Message>;
}) {
  // Source messages are recorded on tool_calls of assistant messages where
  // name === 'update_form_field' and input.form_type === form.form_type.
  const provenance: { field_path: string; source_message_id?: number }[] = [];
  for (const m of messagesById.values()) {
    if (!m.tool_calls) continue;
    for (const tc of m.tool_calls) {
      if (
        tc.name === "update_form_field" &&
        (tc.input as { form_type?: string }).form_type === form.form_type
      ) {
        const inp = tc.input as {
          field_path?: string;
          source_message_id?: number;
        };
        if (inp.field_path) {
          provenance.push({
            field_path: inp.field_path,
            source_message_id: inp.source_message_id,
          });
        }
      }
    }
  }

  if (provenance.length === 0) return null;

  return (
    <details style={{ marginTop: 24 }}>
      <summary
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--muted)",
          cursor: "pointer",
        }}
      >
        Provenance ({provenance.length} field{provenance.length === 1 ? "" : "s"})
      </summary>
      <div style={{ marginTop: 12 }}>
        {provenance.map((p, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 8,
              padding: "6px 0",
              borderBottom: "1px solid var(--pale)",
              fontSize: 13,
            }}
          >
            <code>{p.field_path}</code>
            {p.source_message_id && messagesById.has(p.source_message_id) ? (
              <span className="micro" style={{ color: "var(--mta)" }}>
                Message #{p.source_message_id}
              </span>
            ) : (
              <span className="micro" style={{ color: "var(--muted)" }}>
                —
              </span>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function labelForType(t: FormType): string {
  return TAB_ORDER.find((x) => x.type === t)?.label || t;
}

// ====== Path utilities (shallow path "a.b.0.c") ======
function setPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const parts = path.split(".");
  const root = Array.isArray(obj) ? [...(obj as unknown[])] : { ...obj };
  let cur: Record<string, unknown> | unknown[] = root as
    | Record<string, unknown>
    | unknown[];
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const isIdx = /^\d+$/.test(k);
    const cur2 = cur as Record<string, unknown> | unknown[];
    let next = (cur2 as Record<string, unknown>)[k];
    if (next == null) next = isIdx ? [] : {};
    next = Array.isArray(next) ? [...next] : { ...(next as object) };
    (cur2 as Record<string, unknown>)[k] = next;
    cur = next as Record<string, unknown> | unknown[];
  }
  (cur as Record<string, unknown>)[parts[parts.length - 1]] = value;
  return root as Record<string, unknown>;
}

function diffPaths(
  a: unknown,
  b: unknown,
  prefix = "",
  acc: string[] = [],
): string[] {
  if (a === b) return acc;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a == null ||
    b == null
  ) {
    if (prefix) acc.push(prefix);
    return acc;
  }
  const keys = new Set([
    ...Object.keys(a as object),
    ...Object.keys(b as object),
  ]);
  for (const k of keys) {
    diffPaths(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
      prefix ? `${prefix}.${k}` : k,
      acc,
    );
  }
  return acc;
}
