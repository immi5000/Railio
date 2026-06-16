"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { listAssets, listHistoricalRecords } from "@/lib/api";
import type { Asset, HistoricalRecord } from "@/lib/contract";

function fmtDate(d: string | null): string {
  if (!d) return "—";
  // Records store plain "YYYY-MM-DD" or ISO; show the date portion.
  return d.length > 10 ? d.slice(0, 10) : d;
}

export function FleetAdmin() {
  const { data: assets, isLoading: assetsLoading } = useQuery({
    queryKey: ["assets"],
    queryFn: () => listAssets(),
  });

  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (selected == null && assets && assets.length > 0) {
      setSelected(assets[0].id);
    }
  }, [assets, selected]);

  const selectedAsset = assets?.find((a) => a.id === selected) ?? null;

  return (
    <section style={{ padding: "32px 0 96px" }}>
      <div className="wrap">
        <span className="sect-eyebrow">Admin · Fleet</span>
        <h1 className="h2" style={{ marginTop: 12 }}>
          Fleet &amp; historical records
        </h1>
        <p
          style={{
            color: "var(--muted)",
            marginTop: 8,
            maxWidth: 640,
            fontSize: 14,
          }}
        >
          Select a unit to see its maintenance history — periodic inspections,
          unscheduled repairs, and the tests run on each visit. These records are
          also embedded into the copilot&rsquo;s corpus so the tech can ask about
          a unit&rsquo;s past work.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "240px 1fr",
            gap: 24,
            marginTop: 24,
            alignItems: "start",
          }}
        >
          <div style={{ border: "1px solid var(--border)", background: "#fff" }}>
            {assetsLoading && (
              <div className="micro" style={{ padding: 12, color: "var(--muted)" }}>
                Loading fleet…
              </div>
            )}
            {assets && assets.length === 0 && (
              <div className="micro" style={{ padding: 12, color: "var(--muted)" }}>
                No units in this org.
              </div>
            )}
            {(assets ?? []).map((a) => (
              <UnitButton
                key={a.id}
                asset={a}
                active={a.id === selected}
                onClick={() => setSelected(a.id)}
              />
            ))}
          </div>

          {selectedAsset ? (
            <HistoryTable asset={selectedAsset} />
          ) : (
            <div className="card" style={{ color: "var(--muted)" }}>
              Select a unit.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function UnitButton({
  asset,
  active,
  onClick,
}: {
  asset: Asset;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "12px 14px",
        border: "none",
        borderBottom: "1px solid var(--border)",
        background: active ? "var(--pale)" : "#fff",
        cursor: "pointer",
        font: "inherit",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 14 }}>
        {asset.reporting_mark} {asset.road_number}
      </div>
      <div className="micro" style={{ color: "var(--muted)", marginTop: 2 }}>
        {asset.unit_model}
      </div>
    </button>
  );
}

function HistoryTable({ asset }: { asset: Asset }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["asset-history", asset.id],
    queryFn: () => listHistoricalRecords(asset.id),
  });

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>
          {asset.reporting_mark} {asset.road_number} · {asset.unit_model}
        </h2>
        <span className="micro" style={{ color: "var(--muted)" }}>
          {data?.length ?? 0} record{(data?.length ?? 0) === 1 ? "" : "s"}
        </span>
      </div>

      {isLoading && (
        <div className="card" style={{ color: "var(--muted)" }}>
          <span className="micro">Loading history…</span>
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
          No historical records for this unit yet.
        </div>
      )}
      {data && data.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid var(--border)" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: 900,
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
                <Th>Reported</Th>
                <Th>Completed</Th>
                <Th>Type</Th>
                <Th>Repairs &amp; tests</Th>
                <Th>Technician</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <HistoryRow key={r.id} record={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HistoryRow({ record }: { record: HistoricalRecord }) {
  return (
    <tr style={{ borderBottom: "1px solid var(--border)", verticalAlign: "top" }}>
      <Td>{fmtDate(record.reported_date)}</Td>
      <Td>{fmtDate(record.completed_date)}</Td>
      <Td>{record.record_type ?? "—"}</Td>
      <Td>
        {record.repairs.length > 0 && (
          <div style={{ marginBottom: record.tests.length > 0 ? 8 : 0 }}>
            <strong>Repairs:</strong>
            {record.repairs.map((rep, i) => (
              <div key={i} style={{ marginLeft: 8 }}>
                {rep}
              </div>
            ))}
          </div>
        )}
        {record.tests.length > 0 && (
          <div>
            <strong>Tests:</strong>
            {record.tests.map((t, i) => (
              <div key={i} style={{ marginLeft: 8 }}>
                {t.date ? `${t.date}: ` : ""}
                {t.name}
              </div>
            ))}
          </div>
        )}
        {record.repairs.length === 0 && record.tests.length === 0 && "—"}
      </Td>
      <Td>{record.technician ?? "—"}</Td>
    </tr>
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

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "10px 12px" }}>{children}</td>;
}
