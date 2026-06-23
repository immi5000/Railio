"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  createAsset,
  createHistoricalRecord,
  listAssets,
  listHistoricalRecords,
  updateHistoricalRecord,
} from "@/lib/api";
import type { Asset, HistoricalRecord, HistoricalTest } from "@/lib/contract";

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
  const unitModels = Array.from(
    new Set((assets || []).map((a) => a.unit_model)),
  ).sort();

  return (
    <div className="dash">
      <div className="dash-inner" style={{ paddingBottom: 64, gap: 0 }}>
        <span className="sect-eyebrow">Admin · Fleet</span>
        <h1 className="h2" style={{ marginTop: 12 }}>
          Fleet &amp; historical records
        </h1>
        <p
          style={{
            color: "var(--dash-muted)",
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
          <div>
          <AddUnitForm
            unitModels={unitModels}
            onAdded={(a) => setSelected(a.id)}
          />
          <div
            style={{
              border: "1px solid var(--dash-card-border)",
              borderRadius: 14,
              overflow: "hidden",
              boxShadow: "0 1px 2px rgba(16, 24, 40, 0.04)",
              background: "#fff",
            }}
          >
            {assetsLoading && (
              <div className="micro" style={{ padding: 12, color: "var(--dash-muted)" }}>
                Loading fleet…
              </div>
            )}
            {assets && assets.length === 0 && (
              <div className="micro" style={{ padding: 12, color: "var(--dash-muted)" }}>
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
          </div>

          {selectedAsset ? (
            <HistoryTable asset={selectedAsset} />
          ) : (
            <div className="card" style={{ color: "var(--dash-muted)" }}>
              Select a unit.
            </div>
          )}
        </div>
      </div>
    </div>
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
        borderBottom: "1px solid var(--dash-line)",
        background: active ? "var(--dash-bg)" : "#fff",
        cursor: "pointer",
        font: "inherit",
      }}
    >
      <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontWeight: 500, fontSize: 14 }}>
        {asset.reporting_mark} {asset.road_number}
      </div>
      <div className="micro" style={{ color: "var(--dash-muted)", marginTop: 2 }}>
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
        <h2 style={{ fontFamily: '"Inter", sans-serif', fontSize: 20, fontWeight: 500, letterSpacing: "-0.01em" }}>
          {asset.reporting_mark} {asset.road_number} · {asset.unit_model}
        </h2>
        <span className="micro" style={{ color: "var(--dash-muted)" }}>
          {data?.length ?? 0} record{(data?.length ?? 0) === 1 ? "" : "s"}
        </span>
      </div>

      <AddRecordForm asset={asset} />

      {isLoading && (
        <div className="card" style={{ color: "var(--dash-muted)" }}>
          <span className="micro">Loading history…</span>
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
          No historical records for this unit yet.
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
                  background: "var(--dash-bg)",
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 10.5,
                  fontWeight: 400,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--dash-faint)",
                }}
              >
                <Th>Reported</Th>
                <Th>Completed</Th>
                <Th>Type</Th>
                <Th>Repairs &amp; tests</Th>
                <Th>Technician</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <HistoryRow key={r.id} asset={asset} record={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HistoryRow({
  asset,
  record,
}: {
  asset: Asset;
  record: HistoricalRecord;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <EditRow
        asset={asset}
        record={record}
        onDone={() => setEditing(false)}
      />
    );
  }
  return (
    <tr style={{ borderBottom: "1px solid var(--dash-line)", verticalAlign: "top" }}>
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
      <Td>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
      </Td>
    </tr>
  );
}

function EditRow({
  asset,
  record,
  onDone,
}: {
  asset: Asset;
  record: HistoricalRecord;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [reported, setReported] = useState(record.reported_date ?? "");
  const [completed, setCompleted] = useState(record.completed_date ?? "");
  const [recordType, setRecordType] = useState(record.record_type ?? "");
  const [technician, setTechnician] = useState(record.technician ?? "");
  const [repairsText, setRepairsText] = useState(record.repairs.join("\n"));
  const [testsText, setTestsText] = useState(
    record.tests
      .map((t) => (t.date ? `${t.date}: ${t.name}` : t.name))
      .join("\n"),
  );

  const mut = useMutation({
    mutationFn: () => {
      const repairs = repairsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const tests: HistoricalTest[] = testsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((line) => {
          // Accept "YYYY-MM-DD: name" or just "name".
          const m = line.match(/^(\d{4}-\d{2}-\d{2})\s*:\s*(.+)$/);
          return m ? { date: m[1], name: m[2] } : { date: null, name: line };
        });
      return updateHistoricalRecord(asset.id, record.id, {
        reported_date: reported.trim() || null,
        completed_date: completed.trim() || null,
        record_type: recordType.trim() || null,
        technician: technician.trim() || null,
        repairs,
        tests,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset-history", asset.id] });
      onDone();
    },
  });

  return (
    <tr style={{ borderBottom: "1px solid var(--dash-line)", verticalAlign: "top" }}>
      <Td>
        <input
          className="input"
          style={{ minWidth: 110 }}
          value={reported}
          onChange={(e) => setReported(e.target.value)}
          placeholder="YYYY-MM-DD"
        />
      </Td>
      <Td>
        <input
          className="input"
          style={{ minWidth: 110 }}
          value={completed}
          onChange={(e) => setCompleted(e.target.value)}
          placeholder="YYYY-MM-DD"
        />
      </Td>
      <Td>
        <input
          className="input"
          value={recordType}
          onChange={(e) => setRecordType(e.target.value)}
        />
      </Td>
      <Td>
        <textarea
          className="input"
          rows={3}
          style={{ minWidth: 240 }}
          value={repairsText}
          onChange={(e) => setRepairsText(e.target.value)}
          placeholder="Repairs — one per line"
        />
        <textarea
          className="input"
          rows={3}
          style={{ minWidth: 240, marginTop: 6 }}
          value={testsText}
          onChange={(e) => setTestsText(e.target.value)}
          placeholder="Tests — one per line (optional 'YYYY-MM-DD: name')"
        />
      </Td>
      <Td>
        <input
          className="input"
          value={technician}
          onChange={(e) => setTechnician(e.target.value)}
        />
      </Td>
      <Td>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            type="button"
            className="btn btn-sm"
            disabled={mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onDone}
          >
            Cancel
          </button>
          {mut.error && (
            <span className="micro" style={{ color: "#c0392b" }}>
              {(mut.error as Error).message}
            </span>
          )}
        </div>
      </Td>
    </tr>
  );
}

function AddUnitForm({
  unitModels,
  onAdded,
}: {
  unitModels: string[];
  onAdded: (a: Asset) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reportingMark, setReportingMark] = useState("");
  const [roadNumber, setRoadNumber] = useState("");
  const [unitModel, setUnitModel] = useState("");
  const [inService, setInService] = useState("");
  const [lastInspection, setLastInspection] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      createAsset({
        reporting_mark: reportingMark.trim(),
        road_number: roadNumber.trim(),
        unit_model: unitModel.trim(),
        in_service_date: inService.trim() || undefined,
        last_inspection_at: lastInspection.trim() || undefined,
      }),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      onAdded(a);
      setReportingMark("");
      setRoadNumber("");
      setUnitModel("");
      setInService("");
      setLastInspection("");
      setOpen(false);
    },
  });

  const canSubmit =
    !!reportingMark.trim() && !!roadNumber.trim() && !!unitModel.trim();

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 12, width: "100%" }}
        onClick={() => setOpen(true)}
      >
        + Add unit
      </button>
    );
  }

  return (
    <div
      className="card"
      style={{ marginBottom: 12, display: "grid", gap: 8 }}
    >
      <input
        className="input"
        placeholder="Reporting mark"
        value={reportingMark}
        onChange={(e) => setReportingMark(e.target.value)}
      />
      <input
        className="input"
        placeholder="Road number"
        value={roadNumber}
        onChange={(e) => setRoadNumber(e.target.value)}
      />
      <input
        className="input"
        placeholder="Unit model"
        list="fleet-unit-models"
        value={unitModel}
        onChange={(e) => setUnitModel(e.target.value)}
      />
      <datalist id="fleet-unit-models">
        {unitModels.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <input
        className="input"
        placeholder="In-service date (YYYY-MM-DD)"
        value={inService}
        onChange={(e) => setInService(e.target.value)}
      />
      <input
        className="input"
        placeholder="Last inspection (YYYY-MM-DD)"
        value={lastInspection}
        onChange={(e) => setLastInspection(e.target.value)}
      />
      {mut.error && (
        <span className="micro" style={{ color: "#c0392b" }}>
          {(mut.error as Error).message}
        </span>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!canSubmit || mut.isPending}
          onClick={() => mut.mutate()}
        >
          {mut.isPending ? "Adding…" : "Add unit"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddRecordForm({ asset }: { asset: Asset }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState("");
  const [completed, setCompleted] = useState("");
  const [recordType, setRecordType] = useState("");
  const [technician, setTechnician] = useState("");
  const [repairsText, setRepairsText] = useState("");
  const [testsText, setTestsText] = useState("");

  const mut = useMutation({
    mutationFn: () => {
      const repairs = repairsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const tests: HistoricalTest[] = testsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name) => ({ date: null, name }));
      return createHistoricalRecord(asset.id, {
        reported_date: reported.trim() || null,
        completed_date: completed.trim() || null,
        record_type: recordType.trim() || null,
        technician: technician.trim() || null,
        repairs,
        tests,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset-history", asset.id] });
      setReported("");
      setCompleted("");
      setRecordType("");
      setTechnician("");
      setRepairsText("");
      setTestsText("");
      setOpen(false);
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 12 }}
        onClick={() => setOpen(true)}
      >
        + Add record
      </button>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 12, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className="input"
          placeholder="Reported date (YYYY-MM-DD)"
          value={reported}
          onChange={(e) => setReported(e.target.value)}
        />
        <input
          className="input"
          placeholder="Completed date (YYYY-MM-DD)"
          value={completed}
          onChange={(e) => setCompleted(e.target.value)}
        />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className="input"
          placeholder="Record type (e.g. Quarterly Periodic Inspection)"
          style={{ flex: 1, minWidth: 220 }}
          value={recordType}
          onChange={(e) => setRecordType(e.target.value)}
        />
        <input
          className="input"
          placeholder="Technician"
          value={technician}
          onChange={(e) => setTechnician(e.target.value)}
        />
      </div>
      <textarea
        className="input"
        placeholder="Repairs — one per line"
        rows={3}
        value={repairsText}
        onChange={(e) => setRepairsText(e.target.value)}
      />
      <textarea
        className="input"
        placeholder="Tests — one per line"
        rows={3}
        value={testsText}
        onChange={(e) => setTestsText(e.target.value)}
      />
      {mut.error && (
        <span className="micro" style={{ color: "#c0392b" }}>
          {(mut.error as Error).message}
        </span>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="btn btn-sm"
          disabled={mut.isPending}
          onClick={() => mut.mutate()}
        >
          {mut.isPending ? "Adding…" : "Add record"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "10px 12px",
        borderBottom: "1px solid var(--dash-line)",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "10px 12px" }}>{children}</td>;
}
