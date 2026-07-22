"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPartsFilterOptions, listAssets, listParts, patchPart } from "@/lib/api";
import type {
  ListPartsResponse,
  Part,
  PartLocation,
  UnitModel,
} from "@/lib/contract";
import { deriveTotals, fmtLocations, fmtMoney, locTitle } from "@/lib/parts";
import { SearchableSelect } from "./SearchableSelect";
import { PartDetailModal } from "./PartDetailModal";

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
const PAGE_SIZE = 100;
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

export function PartsAdmin() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [unit, setUnit] = useState<UnitModel | "">("");
  const [location, setLocation] = useState("");
  const [supplier, setSupplier] = useState("");
  const [department, setDepartment] = useState("");
  const [page, setPage] = useState(0);
  // id === null → the modal opens blank, in create mode.
  const [detail, setDetail] = useState<{
    id: number | null;
    focusLocations: boolean;
  } | null>(null);
  const { widths, setWidth } = useColumnWidths();

  const partsKey = ["parts", q, unit, location, supplier, department, page];
  const { data, isLoading, error } = useQuery({
    queryKey: partsKey,
    queryFn: () =>
      listParts({
        q: q || undefined,
        unit_model: unit || undefined,
        location: location || undefined,
        supplier: supplier || undefined,
        department: department || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  });
  const parts = data?.parts ?? [];
  const total = data?.total ?? 0;
  const detailPart =
    detail && detail.id != null ? parts.find((p) => p.id === detail.id) : undefined;
  const anyFilter = !!(q.trim() || unit || location || supplier || department);

  // Unit-model filter options come from the live fleet roster, not a literal.
  const { data: assets } = useQuery({
    queryKey: ["assets"],
    queryFn: () => listAssets(),
  });
  const unitModels = Array.from(
    new Set((assets || []).map((a) => a.unit_model)),
  ).sort();

  // Location / supplier / department filter values, distinct across the org.
  const { data: filterOpts } = useQuery({
    queryKey: ["parts-filter-options"],
    queryFn: () => getPartsFilterOptions(),
  });

  return (
    <div className="dash">
      <div className="dash-inner" style={{ paddingBottom: 64, gap: 0 }}>
        <span className="sect-eyebrow">Admin · Parts</span>
        <h1 className="h2" style={{ marginTop: 12 }}>
          Parts inventory
        </h1>

        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 24,
            marginBottom: 16,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <input
            className="input"
            style={{ maxWidth: 280 }}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder="Search part #, name, supplier, bin, location..."
          />
          <SearchableSelect
            value={unit}
            options={unitModels}
            placeholder="All units"
            width={160}
            onChange={(v) => {
              setUnit(v as UnitModel | "");
              setPage(0);
            }}
          />
          <SearchableSelect
            value={location}
            options={filterOpts?.locations ?? []}
            placeholder="All locations"
            width={160}
            onChange={(v) => {
              setLocation(v);
              setPage(0);
            }}
          />
          <SearchableSelect
            value={supplier}
            options={filterOpts?.suppliers ?? []}
            placeholder="All suppliers"
            width={160}
            onChange={(v) => {
              setSupplier(v);
              setPage(0);
            }}
          />
          <SearchableSelect
            value={department}
            options={filterOpts?.departments ?? []}
            placeholder="All depts"
            width={140}
            onChange={(v) => {
              setDepartment(v);
              setPage(0);
            }}
          />
          <button
            type="button"
            className="btn"
            onClick={() => setDetail({ id: null, focusLocations: false })}
          >
            + Add part
          </button>
          <span
            className="micro"
            style={{ color: "var(--dash-muted)", marginLeft: "auto" }}
          >
            {total} part{total === 1 ? "" : "s"}
          </span>
        </div>

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
        {data && parts.length === 0 && (
          <div className="card" style={{ color: "var(--dash-muted)", textAlign: "center" }}>
            <span className="micro">
              {anyFilter ? "No parts match." : "No parts in inventory yet."}
            </span>
          </div>
        )}
        {data && parts.length > 0 && (
          <div
            className="resp-table"
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
                {parts.map((p) => (
                  <PartRow
                    key={p.id}
                    part={p}
                    onOpenDetail={(focusLocations) =>
                      setDetail({ id: p.id, focusLocations })
                    }
                    onSave={(patch) =>
                      qc.setQueryData<ListPartsResponse>(partsKey, (old) =>
                        old
                          ? {
                              ...old,
                              parts: old.parts.map((x) =>
                                x.id === p.id
                                  ? ({ ...x, ...patch } as Part)
                                  : x,
                              ),
                            }
                          : old,
                      )
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 16,
              alignItems: "center",
            }}
          >
            <button
              type="button"
              className="btn btn-sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <span className="ico-arr-back" aria-hidden="true" /> Prev
            </button>
            <span className="micro" style={{ color: "var(--dash-muted)" }}>
              Showing {page * PAGE_SIZE + 1}–
              {Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              disabled={(page + 1) * PAGE_SIZE >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next <span className="ico-arr" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {detail && (detail.id == null || detailPart) && (
        <PartDetailModal
          part={detailPart ?? null}
          focusLocations={detail.focusLocations}
          onClose={() => setDetail(null)}
          onSaved={(updated) => {
            qc.setQueryData<ListPartsResponse>(partsKey, (old) =>
              old
                ? {
                    ...old,
                    parts: old.parts.map((x) =>
                      x.id === updated.id ? updated : x,
                    ),
                  }
                : old,
            );
            qc.invalidateQueries({ queryKey: ["parts"] });
            qc.invalidateQueries({ queryKey: ["parts-filter-options"] });
            setDetail(null);
          }}
        />
      )}
    </div>
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
  onOpenDetail,
}: {
  part: Part;
  onSave: (patch: Partial<Part>) => void;
  onOpenDetail: (focusLocations: boolean) => void;
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

  // Draft qty/cost drive the live Value cell as the user types; they resync from
  // the server row on refetch, but not while the field is focused (so a
  // background invalidate can't clobber an in-progress edit).
  const [draftQty, setDraftQty] = useState(String(part.qty_on_hand));
  const [draftCost, setDraftCost] = useState(
    part.avg_cost != null ? String(part.avg_cost) : "",
  );
  const qtyRef = useRef<HTMLInputElement>(null);
  const costRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== qtyRef.current) {
      setDraftQty(String(part.qty_on_hand));
    }
  }, [part.qty_on_hand]);
  useEffect(() => {
    if (document.activeElement !== costRef.current) {
      setDraftCost(part.avg_cost != null ? String(part.avg_cost) : "");
    }
  }, [part.avg_cost]);

  const locs = part.locations || [];
  const hasLocs = locs.length > 0;
  // With locations everything derives from them (so an allocation shows the
  // right number optimistically); without, it's the live qty x cost the user
  // is typing.
  const totals = hasLocs
    ? deriveTotals(locs, part.qty_on_hand, part.avg_cost)
    : deriveTotals(
        null,
        Number(draftQty) || 0,
        draftCost === "" ? null : Number(draftCost),
      );

  // A part with 2+ locations shows a locked On hand (see below), so this only
  // fires for 0- or 1-location parts. With one location the total IS that
  // location's quantity, so route the edit through it to keep them in step.
  function commitQty() {
    const n = Number(draftQty) || 0;
    if (n === part.qty_on_hand) return;
    if (locs.length === 0) {
      commit({ qty_on_hand: n });
    } else {
      commitLocations([{ ...locs[0], qty: n }]);
    }
  }

  function commitCost() {
    const c = draftCost === "" ? null : Number(draftCost);
    if (c === part.avg_cost) return;
    commit({ avg_cost: c });
  }

  // The server re-derives these identically and overrides whatever we send;
  // including them just keeps the optimistic row honest until the refetch.
  function commitLocations(newLocs: PartLocation[]) {
    const t = deriveTotals(newLocs, 0, null);
    commit({
      locations: newLocs.map((l) => ({
        ...l,
        value: l.avg_cost != null ? l.qty * l.avg_cost : null,
      })),
      qty_on_hand: t.qty,
      avg_cost: t.avgCost,
      on_hand_value: t.value,
    });
  }

  return (
    <tr style={{ borderBottom: "1px solid var(--dash-line)" }}>
      <Td label="Part #">
        <button
          type="button"
          className="cell-link"
          title="Open part details"
          onClick={() => onOpenDetail(false)}
        >
          {part.part_number}
        </button>
      </Td>
      <Td label="Name">
        <Cell value={part.name} onCommit={(v) => commit({ name: v })} />
      </Td>
      <Td label="Description">
        <Cell
          value={part.description || ""}
          onCommit={(v) => commit({ description: v || null })}
        />
      </Td>
      <Td label="Compatible">
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
      <Td label="Bin">
        <Cell
          value={part.bin_location || ""}
          onCommit={(v) => commit({ bin_location: v || null })}
        />
      </Td>
      <Td label="On hand">
        {locs.length > 1 ? (
          <ReadCell
            boxed
            value={String(totals.qty)}
            title="Totalled from location quantities — edit a location to change it"
          />
        ) : (
          <input
            ref={qtyRef}
            value={draftQty}
            type="number"
            onChange={(e) => setDraftQty(e.target.value)}
            onBlur={commitQty}
            style={CELL_INPUT_STYLE}
          />
        )}
      </Td>
      <Td label="Avg cost">
        {hasLocs ? (
          <ReadCell
            value={fmtMoney(totals.avgCost)}
            title="Weighted average of this part's location costs — edit a location to change it"
          />
        ) : (
          <input
            ref={costRef}
            value={draftCost}
            type="number"
            onChange={(e) => setDraftCost(e.target.value)}
            onBlur={commitCost}
            style={CELL_INPUT_STYLE}
          />
        )}
      </Td>
      <Td label="Value">
        <ReadCell value={fmtMoney(totals.value)} />
      </Td>
      <Td label="Locations">
        <button
          type="button"
          className="cell-link"
          title={locTitle(part.locations) || "Add locations"}
          onClick={() => onOpenDetail(true)}
          style={{ color: locs.length ? undefined : "var(--dash-faint)" }}
        >
          {fmtLocations(part.locations) || "— add —"}
        </button>
      </Td>
      <Td label="Dept">
        <Cell
          value={part.department || ""}
          onCommit={(v) => commit({ department: v || null })}
        />
      </Td>
      <Td label="Supplier">
        <Cell
          value={part.supplier || ""}
          onCommit={(v) => commit({ supplier: v || null })}
        />
      </Td>
      <Td label="Lead (d)">
        <Cell
          value={part.lead_time_days != null ? String(part.lead_time_days) : ""}
          numeric
          onCommit={(v) =>
            commit({ lead_time_days: v === "" ? null : Number(v) })
          }
        />
      </Td>
      <Td label="Alternates">
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

function Td({
  children,
  label,
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <td
      data-label={label}
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

// `boxed` renders a filled grey, not-allowed cell — used where a normally
// editable column is locked (a multi-location part's On hand is totalled from
// its locations, so it can't be typed into directly).
function ReadCell({
  value,
  title,
  boxed,
}: {
  value: string;
  title?: string;
  boxed?: boolean;
}) {
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
        ...(boxed
          ? { background: "var(--dash-bg)", cursor: "not-allowed" }
          : null),
      }}
    >
      {value}
    </div>
  );
}

const CELL_INPUT_STYLE: React.CSSProperties = {
  appearance: "none",
  border: 0,
  outline: 0,
  background: "transparent",
  padding: "10px 12px",
  width: "100%",
  fontFamily: "inherit",
  fontSize: 13,
};

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
      style={CELL_INPUT_STYLE}
    />
  );
}
