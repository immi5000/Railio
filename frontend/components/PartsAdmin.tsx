"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPart, listAssets, listParts, patchPart } from "@/lib/api";
import type { Part, PartLocation, UnitModel } from "@/lib/contract";

// Column order + default widths (px). Headers, the <colgroup>, and the resize
// handles all key off this so they stay in sync.
const COLUMNS: { key: string; label: string; width: number }[] = [
  { key: "part_number", label: "Part #", width: 120 },
  { key: "name", label: "Name", width: 200 },
  { key: "description", label: "Description", width: 280 },
  { key: "compatible", label: "Compatible", width: 140 },
  { key: "bin", label: "Bin", width: 140 },
  { key: "qty", label: "On hand", width: 90 },
  { key: "avg_cost", label: "Avg cost", width: 100 },
  { key: "value", label: "Value", width: 110 },
  { key: "locations", label: "Locations", width: 130 },
  { key: "dept", label: "Dept", width: 120 },
  { key: "supplier", label: "Supplier", width: 160 },
  { key: "lead", label: "Lead (d)", width: 80 },
  { key: "alternates", label: "Alternates", width: 160 },
];
const MIN_COL_WIDTH = 60;
const WIDTHS_STORAGE_KEY = "railio_parts_col_widths";

// Resizable column widths, persisted to localStorage so they survive reloads.
function useColumnWidths() {
  const [widths, setWidths] = useState<number[]>(() =>
    COLUMNS.map((c) => c.width),
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WIDTHS_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved) && saved.length === COLUMNS.length) {
          setWidths(saved.map((n) => Math.max(MIN_COL_WIDTH, Number(n))));
        }
      }
    } catch {
      // ignore malformed storage
    }
  }, []);

  const setWidth = useCallback((index: number, width: number) => {
    setWidths((prev) => {
      const next = [...prev];
      next[index] = Math.max(MIN_COL_WIDTH, Math.round(width));
      try {
        localStorage.setItem(WIDTHS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore quota/availability errors
      }
      return next;
    });
  }, []);

  return { widths, setWidth };
}

function fmtMoney(n: number | null): string {
  if (n == null) return "";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function fmtLocations(locs: PartLocation[]): string {
  if (!locs || locs.length === 0) return "";
  if (locs.length === 1) return `${locs[0].location} · ${locs[0].qty}`;
  return `${locs.length} locations`;
}

function locTitle(locs: PartLocation[]): string {
  if (!locs || locs.length === 0) return "";
  return locs.map((l) => `${l.location}: ${l.qty}`).join("\n");
}

export function PartsAdmin() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [unit, setUnit] = useState<UnitModel | "">("");
  const [adding, setAdding] = useState(false);
  const { widths, setWidth } = useColumnWidths();

  const { data, isLoading, error } = useQuery({
    queryKey: ["parts", q, unit],
    queryFn: () =>
      listParts({ q: q || undefined, unit_model: unit || undefined }),
  });

  // Unit-model filter options come from the live fleet roster, not a literal.
  const { data: assets } = useQuery({
    queryKey: ["assets"],
    queryFn: () => listAssets(),
  });
  const unitModels = Array.from(
    new Set((assets || []).map((a) => a.unit_model)),
  ).sort();

  return (
    <div className="dash">
      <div className="dash-inner" style={{ paddingBottom: 64, gap: 0 }}>
        <span className="sect-eyebrow">Admin · Parts</span>
        <h1 className="h2" style={{ marginTop: 12 }}>
          Parts inventory
        </h1>
        <p
          style={{
            color: "var(--dash-muted)",
            marginTop: 8,
            maxWidth: 640,
            fontSize: 14,
          }}
        >
          Click any cell to edit. Changes save when you blur the field.
          Unpolished by design — this is the SME&rsquo;s tool during pilot setup.
        </p>

        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 24,
            marginBottom: 16,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <input
            className="input"
            style={{ maxWidth: 320 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search part #, name, supplier..."
          />
          <select
            className="select"
            style={{ maxWidth: 200 }}
            value={unit}
            onChange={(e) => setUnit(e.target.value as UnitModel | "")}
          >
            <option value="">All units</option>
            {unitModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setAdding((v) => !v)}
          >
            {adding ? "Cancel" : "+ Add part"}
          </button>
          <span
            className="micro"
            style={{ color: "var(--dash-muted)", marginLeft: "auto" }}
          >
            {data?.length ?? 0} part{(data?.length ?? 0) === 1 ? "" : "s"}
          </span>
        </div>

        {adding && <AddPartForm onDone={() => setAdding(false)} />}

        {isLoading && (
          <div className="card" style={{ color: "var(--dash-muted)" }}>
            <span className="micro">Loading parts…</span>
          </div>
        )}
        {error && (
          <div className="card" style={{ borderColor: "#e9b8b2" }}>
            <span className="micro" style={{ color: "#c0392b" }}>
              Failed
            </span>
            <p style={{ marginTop: 8 }}>{(error as Error).message}</p>
          </div>
        )}
        {data && data.length === 0 && (
          <div className="card" style={{ color: "var(--dash-muted)" }}>
            No parts match.
          </div>
        )}
        {data && data.length > 0 && (
          <div
            style={{
              overflowX: "auto",
              border: "1px solid var(--dash-card-border)",
              borderRadius: 14,
              boxShadow: "0 1px 2px rgba(16, 24, 40, 0.04)",
            }}
          >
            <table
              style={{
                borderCollapse: "collapse",
                tableLayout: "fixed",
                width: widths.reduce((a, b) => a + b, 0),
                fontSize: 13,
                background: "#fff",
              }}
            >
              <colgroup>
                {widths.map((w, i) => (
                  <col key={COLUMNS[i].key} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr
                  style={{
                    background: "var(--dash-bg)",
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: 10.5,
                    fontWeight: 400,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: "var(--dash-faint)",
                  }}
                >
                  {COLUMNS.map((c, i) => (
                    <ResizableTh
                      key={c.key}
                      label={c.label}
                      width={widths[i]}
                      onResize={(w) => setWidth(i, w)}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <PartRow
                    key={p.id}
                    part={p}
                    onSave={(patch) =>
                      qc.setQueryData<Part[]>(["parts", q, unit], (old) =>
                        old?.map((x) =>
                          x.id === p.id ? ({ ...x, ...patch } as Part) : x,
                        ),
                      )
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AddPartForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [partNumber, setPartNumber] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [compatible, setCompatible] = useState("");
  const [bin, setBin] = useState("");
  const [qty, setQty] = useState("0");
  const [avgCost, setAvgCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [lead, setLead] = useState("");
  const [alternates, setAlternates] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      createPart({
        part_number: partNumber.trim(),
        name: name.trim(),
        description: description.trim() || null,
        compatible_units: compatible
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        bin_location: bin.trim() || null,
        qty_on_hand: Number(qty) || 0,
        avg_cost: avgCost === "" ? null : Number(avgCost),
        supplier: supplier.trim() || null,
        lead_time_days: lead === "" ? null : Number(lead),
        alternate_part_numbers: alternates
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parts"] });
      onDone();
    },
  });

  const canSubmit = !!partNumber.trim() && !!name.trim();

  return (
    <div
      className="card"
      style={{
        marginBottom: 16,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: 8,
        alignItems: "end",
      }}
    >
      <Field label="Part # *">
        <input
          className="input"
          value={partNumber}
          onChange={(e) => setPartNumber(e.target.value)}
        />
      </Field>
      <Field label="Name *">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Description">
        <input
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field label="Compatible (comma-sep)">
        <input
          className="input"
          value={compatible}
          onChange={(e) => setCompatible(e.target.value)}
        />
      </Field>
      <Field label="Bin">
        <input
          className="input"
          value={bin}
          onChange={(e) => setBin(e.target.value)}
        />
      </Field>
      <Field label="On hand">
        <input
          className="input"
          type="number"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
      </Field>
      <Field label="Avg cost">
        <input
          className="input"
          type="number"
          value={avgCost}
          onChange={(e) => setAvgCost(e.target.value)}
        />
      </Field>
      <Field label="Supplier">
        <input
          className="input"
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
        />
      </Field>
      <Field label="Lead (d)">
        <input
          className="input"
          type="number"
          value={lead}
          onChange={(e) => setLead(e.target.value)}
        />
      </Field>
      <Field label="Alternates (comma-sep)">
        <input
          className="input"
          value={alternates}
          onChange={(e) => setAlternates(e.target.value)}
        />
      </Field>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!canSubmit || mut.isPending}
          onClick={() => mut.mutate()}
        >
          {mut.isPending ? "Adding…" : "Add part"}
        </button>
        {mut.error && (
          <span className="micro" style={{ color: "#c0392b" }}>
            {(mut.error as Error).message}
          </span>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span className="micro" style={{ color: "var(--dash-muted)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function ResizableTh({
  label,
  width,
  onResize,
}: {
  label: string;
  width: number;
  onResize: (width: number) => void;
}) {
  const startX = useRef(0);
  const startW = useRef(0);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    startX.current = e.clientX;
    startW.current = width;

    function onMove(ev: PointerEvent) {
      onResize(startW.current + (ev.clientX - startX.current));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <th
      style={{
        position: "relative",
        textAlign: "left",
        padding: "10px 12px",
        borderBottom: "1px solid var(--dash-line)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {label}
      <div
        onPointerDown={onPointerDown}
        title="Drag to resize"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: 8,
          height: "100%",
          cursor: "col-resize",
          userSelect: "none",
          touchAction: "none",
        }}
      />
    </th>
  );
}

function PartRow({
  part,
  onSave,
}: {
  part: Part;
  onSave: (patch: Partial<Part>) => void;
}) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: (patch: Partial<Part>) => patchPart(part.id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parts"] }),
  });

  function commit(patch: Partial<Part>) {
    onSave(patch);
    mut.mutate(patch);
  }

  return (
    <tr style={{ borderBottom: "1px solid var(--dash-line)" }}>
      <Td>
        <Cell value={part.part_number} onCommit={(v) => commit({ part_number: v })} />
      </Td>
      <Td>
        <Cell value={part.name} onCommit={(v) => commit({ name: v })} />
      </Td>
      <Td>
        <Cell
          value={part.description || ""}
          onCommit={(v) => commit({ description: v || null })}
        />
      </Td>
      <Td>
        <Cell
          value={(part.compatible_units || []).join(",")}
          onCommit={(v) =>
            commit({
              compatible_units: v
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0),
            })
          }
        />
      </Td>
      <Td>
        <Cell
          value={part.bin_location || ""}
          onCommit={(v) => commit({ bin_location: v || null })}
        />
      </Td>
      <Td>
        <Cell
          value={String(part.qty_on_hand)}
          numeric
          onCommit={(v) => commit({ qty_on_hand: Number(v) || 0 })}
        />
      </Td>
      <Td>
        <Cell
          value={part.avg_cost != null ? String(part.avg_cost) : ""}
          numeric
          onCommit={(v) => commit({ avg_cost: v === "" ? null : Number(v) })}
        />
      </Td>
      <Td>
        <ReadCell value={fmtMoney(part.on_hand_value)} />
      </Td>
      <Td>
        <ReadCell value={fmtLocations(part.locations)} title={locTitle(part.locations)} />
      </Td>
      <Td>
        <Cell
          value={part.department || ""}
          onCommit={(v) => commit({ department: v || null })}
        />
      </Td>
      <Td>
        <Cell
          value={part.supplier || ""}
          onCommit={(v) => commit({ supplier: v || null })}
        />
      </Td>
      <Td>
        <Cell
          value={part.lead_time_days != null ? String(part.lead_time_days) : ""}
          numeric
          onCommit={(v) =>
            commit({ lead_time_days: v === "" ? null : Number(v) })
          }
        />
      </Td>
      <Td>
        <Cell
          value={(part.alternate_part_numbers || []).join(",")}
          onCommit={(v) =>
            commit({
              alternate_part_numbers: v
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </Td>
    </tr>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td
      style={{
        padding: 0,
        borderRight: "1px solid var(--dash-line)",
        overflow: "hidden",
      }}
    >
      {children}
    </td>
  );
}

function ReadCell({ value, title }: { value: string; title?: string }) {
  return (
    <div
      title={title}
      style={{
        padding: "10px 12px",
        width: "100%",
        fontSize: 13,
        color: "var(--dash-muted)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {value}
    </div>
  );
}

function Cell({
  value,
  onCommit,
  numeric,
}: {
  value: string;
  onCommit: (v: string) => void;
  numeric?: boolean;
}) {
  const [v, setV] = useState(value);
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== value) onCommit(v);
      }}
      type={numeric ? "number" : "text"}
      style={{
        appearance: "none",
        border: 0,
        outline: 0,
        background: "transparent",
        padding: "10px 12px",
        width: "100%",
        fontFamily: "inherit",
        fontSize: 13,
      }}
    />
  );
}
