"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listParts, patchPart } from "@/lib/api";
import type { Part, UnitModel } from "@/lib/contract";

export function PartsAdmin() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [unit, setUnit] = useState<UnitModel | "">("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["parts", q, unit],
    queryFn: () =>
      listParts({ q: q || undefined, unit_model: unit || undefined }),
  });

  return (
    <section style={{ padding: "32px 0 96px" }}>
      <div className="wrap">
        <span className="sect-eyebrow">Admin · Parts</span>
        <h1 className="h2" style={{ marginTop: 12 }}>
          Parts inventory
        </h1>
        <p
          style={{
            color: "var(--muted)",
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
            <option value="ES44AC">ES44AC</option>
            <option value="ET44AC">ET44AC</option>
          </select>
          <span
            className="micro"
            style={{ color: "var(--muted)", marginLeft: "auto" }}
          >
            {data?.length ?? 0} part{(data?.length ?? 0) === 1 ? "" : "s"}
          </span>
        </div>

        {isLoading && (
          <div className="card" style={{ color: "var(--muted)" }}>
            <span className="micro">Loading parts…</span>
          </div>
        )}
        {error && (
          <div className="card" style={{ borderColor: "#f08d80" }}>
            <span className="micro" style={{ color: "#8a1f15" }}>
              Failed
            </span>
            <p style={{ marginTop: 8 }}>{(error as Error).message}</p>
          </div>
        )}
        {data && data.length === 0 && (
          <div className="card" style={{ color: "var(--muted)" }}>
            No parts match.
          </div>
        )}
        {data && data.length > 0 && (
          <div style={{ overflowX: "auto", border: "1px solid var(--border)" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: 1100,
                fontSize: 13,
                background: "#fff",
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "var(--pale)",
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--muted)",
                  }}
                >
                  <Th>Part #</Th>
                  <Th>Name</Th>
                  <Th>Description</Th>
                  <Th>Compatible</Th>
                  <Th>Bin</Th>
                  <Th>On hand</Th>
                  <Th>Supplier</Th>
                  <Th>Lead (d)</Th>
                  <Th>Alternates</Th>
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
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "10px 12px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {children}
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
    <tr style={{ borderBottom: "1px solid var(--pale)" }}>
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
                .filter((s): s is UnitModel =>
                  s === "ES44AC" || s === "ET44AC",
                ),
            })
          }
        />
      </Td>
      <Td>
        <Cell
          value={part.bin_location}
          onCommit={(v) => commit({ bin_location: v })}
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
      style={{ padding: 0, borderRight: "1px solid var(--pale)" }}
    >
      {children}
    </td>
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
