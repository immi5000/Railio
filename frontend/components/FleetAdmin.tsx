"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  createAsset,
  createHistoricalRecord,
  listAssets,
  listHistoricalRecords,
  patchAsset,
  updateHistoricalRecord,
} from "@/lib/api";
import type { Asset, HistoricalRecord, HistoricalTest } from "@/lib/contract";
import {
  inspectionStatuses,
  mostUrgent,
  oosDays,
  STATE_COLOR,
} from "@/lib/inspections";
import { FacetGroup } from "./FacetGroup";

function fmtDate(d: string | null): string {
  if (!d) return "—";
  // Records store plain "YYYY-MM-DD" or ISO; show the date portion.
  return d.length > 10 ? d.slice(0, 10) : d;
}

const STATUS_FACETS = ["overdue", "due_soon", "oos", "in_service"] as const;
const STATUS_LABELS: Record<string, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  oos: "Out of service",
  in_service: "In service",
};

// Unit-card status dot: OOS units read danger; otherwise the most-urgent
// inspection's state drives the color (overdue/due-soon/ok).
function unitDotColor(a: Asset): string {
  if (a.out_of_service) return "var(--dash-danger)";
  return STATE_COLOR[mostUrgent(a).state];
}

// The set of status facets an asset matches, for the multi-select filter.
function assetStatusKeys(a: Asset): Set<string> {
  const keys = new Set<string>();
  keys.add(a.out_of_service ? "oos" : "in_service");
  const urgent = mostUrgent(a);
  if (urgent.state === "overdue") keys.add("overdue");
  if (urgent.state === "due_soon") keys.add("due_soon");
  return keys;
}

function toggleInSet(
  set: Set<string>,
  setter: (s: Set<string>) => void,
  value: string,
) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  setter(next);
}

export function FleetAdmin() {
  const { data: assets, isLoading: assetsLoading } = useQuery({
    queryKey: ["assets"],
    queryFn: () => listAssets(),
  });

  const [selected, setSelected] = useState<number | null>(null);
  const [selMarks, setSelMarks] = useState<Set<string>>(new Set());
  const [selModels, setSelModels] = useState<Set<string>>(new Set());
  const [selStatuses, setSelStatuses] = useState<Set<string>>(new Set());

  const allAssets = assets ?? [];
  const selectedAsset = allAssets.find((a) => a.id === selected) ?? null;
  const unitModels = Array.from(
    new Set(allAssets.map((a) => a.unit_model)),
  ).sort();
  const allMarks = Array.from(
    new Set(allAssets.map((a) => a.reporting_mark)),
  ).sort();

  // Multi-select facets are OR within a facet, AND across facets; empty = all.
  const visibleAssets = allAssets.filter(
    (a) =>
      (selMarks.size === 0 || selMarks.has(a.reporting_mark)) &&
      (selModels.size === 0 || selModels.has(a.unit_model)) &&
      (selStatuses.size === 0 ||
        [...selStatuses].some((s) => assetStatusKeys(a).has(s))),
  );

  // Group the visible fleet by railroad (reporting mark) for sectioned display.
  const groups = new Map<string, Asset[]>();
  for (const a of visibleAssets) {
    const arr = groups.get(a.reporting_mark) ?? [];
    arr.push(a);
    groups.set(a.reporting_mark, arr);
  }
  const groupEntries = Array.from(groups.entries()).sort((x, y) =>
    x[0].localeCompare(y[0]),
  );

  return (
    <div className="dash">
      <div className="dash-inner" style={{ paddingBottom: 64, gap: 0 }}>
        <span className="sect-eyebrow">Admin · Fleet</span>
        <h1 className="h2" style={{ marginTop: 12, marginBottom: 24 }}>
          Fleet &amp; historical records
        </h1>

        <FleetFilterBar
          allMarks={allMarks}
          allModels={unitModels}
          selMarks={selMarks}
          selModels={selModels}
          onToggleMark={(v) => toggleInSet(selMarks, setSelMarks, v)}
          onToggleModel={(v) => toggleInSet(selModels, setSelModels, v)}
        />

        <div className="admin-split" style={{ marginTop: 8 }}>
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 12,
                flexWrap: "wrap",
              }}
            >
              <h2 className="h4">Units</h2>
              <span className="micro" style={{ color: "var(--dash-link)" }}>
                {visibleAssets.length === allAssets.length
                  ? allAssets.length
                  : `${visibleAssets.length} of ${allAssets.length}`}
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {STATUS_FACETS.map((opt) => {
                  const on = selStatuses.has(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggleInSet(selStatuses, setSelStatuses, opt)}
                      className="micro"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "3px 10px",
                        borderRadius: 999,
                        cursor: "pointer",
                        border: `1px solid ${on ? "var(--dash-link)" : "var(--dash-border)"}`,
                        background: on ? "rgba(38, 131, 235, 0.08)" : "#fff",
                        color: on ? "var(--dash-link)" : "var(--dash-muted)",
                        fontFamily: '"IBM Plex Mono", monospace',
                      }}
                    >
                      {STATUS_LABELS[opt] ?? opt}
                    </button>
                  );
                })}
              </div>
            </div>
            <AddUnitForm
              unitModels={unitModels}
              onAdded={(a) => setSelected(a.id)}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {assetsLoading && (
                <div className="micro" style={{ padding: 12, color: "var(--dash-muted)" }}>
                  Loading fleet…
                </div>
              )}
              {assets && allAssets.length === 0 && (
                <div className="micro" style={{ padding: 12, color: "var(--dash-muted)" }}>
                  No units in this org.
                </div>
              )}
              {assets && allAssets.length > 0 && visibleAssets.length === 0 && (
                <div className="micro" style={{ padding: 12, color: "var(--dash-muted)" }}>
                  No units match the filters.
                </div>
              )}
              {groupEntries.map(([mark, units]) => (
                <div key={mark} className="fleet-group">
                  <div className="fleet-group-label">
                    {mark} · {units.length}
                  </div>
                  {units.map((a) => (
                    <UnitButton
                      key={a.id}
                      asset={a}
                      active={a.id === selected}
                      onClick={() => setSelected(a.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Offset by the left column's "Units" header height (.h4 ~22px +
              12px margin) so the right column's top edge lines up with the
              "+ Add unit" button rather than the section header — whether a
              unit is selected (detail) or not (placeholder). */}
          <div style={{ marginTop: 34 }}>
            {selectedAsset ? (
              <UnitDetail
                key={selectedAsset.id}
                asset={selectedAsset}
                unitModels={unitModels}
              />
            ) : (
              <div className="dash-card work-placeholder">
                Select a unit to view details.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Full-width filter bar above the units list + detail. Facet groups sit side
// by side and wrap; each facet is only shown when there's more than one option
// to pick (Railroad/Model), Status always shows.
function FleetFilterBar({
  allMarks,
  allModels,
  selMarks,
  selModels,
  onToggleMark,
  onToggleModel,
}: {
  allMarks: string[];
  allModels: string[];
  selMarks: Set<string>;
  selModels: Set<string>;
  onToggleMark: (v: string) => void;
  onToggleModel: (v: string) => void;
}) {
  const showMarks = allMarks.length > 1;
  const showModels = allModels.length > 1;
  if (!showMarks && !showModels) return null;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "12px 32px",
        marginTop: 20,
      }}
    >
      {showMarks && (
        <FacetGroup
          title="Railroad"
          options={allMarks}
          selected={selMarks}
          onToggle={onToggleMark}
        />
      )}
      {showModels && (
        <FacetGroup
          title="Model"
          options={allModels}
          selected={selModels}
          onToggle={onToggleModel}
        />
      )}
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
      className="work-ticket"
      data-active={active}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            className="fleet-dot"
            style={{ background: unitDotColor(asset) }}
            aria-hidden="true"
          />
          <span
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontWeight: 700,
              fontSize: 15,
              color: "#000",
            }}
          >
            {asset.reporting_mark} {asset.road_number}
          </span>
        </span>
        {asset.out_of_service && (
          <span
            className="micro"
            style={{
              color: "var(--dash-danger)",
              fontWeight: 600,
              fontFamily: '"IBM Plex Mono", monospace',
            }}
          >
            OOS
          </span>
        )}
      </div>
      <div className="dash-mono" style={{ color: "var(--dash-muted)", fontSize: 12 }}>
        {asset.unit_model}
      </div>
    </button>
  );
}

// Detail panel for the selected unit: identity + edit, the full periodic-
// inspection breakdown (all three intervals), and the historical-records table.
function UnitDetail({
  asset,
  unitModels,
}: {
  asset: Asset;
  unitModels: string[];
}) {
  const [editing, setEditing] = useState(false);
  const statuses = inspectionStatuses(asset);
  const down = oosDays(asset);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {editing ? (
        <UnitEditForm
          asset={asset}
          unitModels={unitModels}
          onDone={() => setEditing(false)}
        />
      ) : (
        <div className="dash-card" style={{ padding: "22px 28px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 16,
            }}
          >
            <div>
              <h2 className="dash-section-title" style={{ fontWeight: 700 }}>
                {asset.reporting_mark} {asset.road_number}
              </h2>
              <p className="dash-section-sub" style={{ marginTop: 4 }}>
                {asset.unit_model}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setEditing(true)}
            >
              Edit unit
            </button>
          </div>

          <div
            className="micro"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              marginTop: 14,
              color: "var(--dash-muted)",
            }}
          >
            <span>
              In service:{" "}
              <span style={{ color: "#000" }}>{fmtDate(asset.in_service_date)}</span>
            </span>
            <span>
              Status:{" "}
              {down !== null ? (
                <span style={{ color: "var(--dash-danger)", fontWeight: 600 }}>
                  Out of service · down {down}d
                </span>
              ) : (
                <span style={{ color: "#000" }}>In service</span>
              )}
            </span>
          </div>

          <div className="fleet-insp">
            {statuses.map((s) => (
              <div key={s.key} className="fleet-insp-row">
                <span className="fleet-insp-label">{s.label}</span>
                <span style={{ color: STATE_COLOR[s.state] }}>
                  {s.nextDue ? `Due ${fmtDate(s.nextDue)}` : "No inspection on file"}
                  {s.state === "overdue"
                    ? " · overdue"
                    : s.state === "due_soon"
                      ? " · due soon"
                      : ""}
                  {s.oosCredit > 0 && (
                    <span className="micro" style={{ color: "var(--dash-muted)" }}>
                      {" · "}adjusted +{s.oosCredit}d for OOS
                    </span>
                  )}
                </span>
                <span className="micro" style={{ color: "var(--dash-faint)" }}>
                  last {fmtDate(s.last)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <HistoryTable asset={asset} />
    </div>
  );
}

function InspectionFields({
  last92,
  setLast92,
  last368,
  setLast368,
  last1104,
  setLast1104,
  oos,
  setOos,
  oosSince,
  setOosSince,
}: {
  last92: string;
  setLast92: (v: string) => void;
  last368: string;
  setLast368: (v: string) => void;
  last1104: string;
  setLast1104: (v: string) => void;
  oos: boolean;
  setOos: (v: boolean) => void;
  oosSince: string;
  setOosSince: (v: string) => void;
}) {
  return (
    <>
      <input
        className="input"
        placeholder="Last 92-day inspection (YYYY-MM-DD)"
        value={last92}
        onChange={(e) => setLast92(e.target.value)}
      />
      <input
        className="input"
        placeholder="Last 368-day inspection (YYYY-MM-DD)"
        value={last368}
        onChange={(e) => setLast368(e.target.value)}
      />
      <input
        className="input"
        placeholder="Last 1104-day inspection (YYYY-MM-DD)"
        value={last1104}
        onChange={(e) => setLast1104(e.target.value)}
      />
      <label
        className="micro"
        style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--dash-muted)" }}
      >
        <input
          type="checkbox"
          checked={oos}
          onChange={(e) => setOos(e.target.checked)}
        />
        Out of service
      </label>
      {oos && (
        <input
          className="input"
          placeholder="OOS since (YYYY-MM-DD)"
          value={oosSince}
          onChange={(e) => setOosSince(e.target.value)}
        />
      )}
    </>
  );
}

function UnitEditForm({
  asset,
  unitModels,
  onDone,
}: {
  asset: Asset;
  unitModels: string[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [reportingMark, setReportingMark] = useState(asset.reporting_mark);
  const [roadNumber, setRoadNumber] = useState(asset.road_number);
  const [unitModel, setUnitModel] = useState(asset.unit_model);
  const [inService, setInService] = useState(asset.in_service_date ?? "");
  const [last92, setLast92] = useState(asset.last_92_day_at ?? "");
  const [last368, setLast368] = useState(asset.last_368_day_at ?? "");
  const [last1104, setLast1104] = useState(asset.last_1104_day_at ?? "");
  const [outOfService, setOutOfService] = useState(asset.out_of_service);
  const [oosSince, setOosSince] = useState(asset.oos_since ?? "");

  const mut = useMutation({
    mutationFn: () =>
      patchAsset(asset.id, {
        reporting_mark: reportingMark.trim(),
        road_number: roadNumber.trim(),
        unit_model: unitModel.trim(),
        in_service_date: inService.trim() || null,
        last_92_day_at: last92.trim() || null,
        last_368_day_at: last368.trim() || null,
        last_1104_day_at: last1104.trim() || null,
        out_of_service: outOfService,
        oos_since: outOfService ? oosSince.trim() || null : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      // Fleet change → re-check which manuals are relevant to the org's models.
      qc.invalidateQueries({ queryKey: ["corpus-documents"] });
      onDone();
    },
  });

  const canSubmit =
    !!reportingMark.trim() && !!roadNumber.trim() && !!unitModel.trim();

  return (
    <div
      className="card"
      style={{
        display: "grid",
        gap: 8,
        borderRadius: 0,
        borderLeft: "none",
        borderRight: "none",
        borderTop: "none",
      }}
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
      <InspectionFields
        last92={last92}
        setLast92={setLast92}
        last368={last368}
        setLast368={setLast368}
        last1104={last1104}
        setLast1104={setLast1104}
        oos={outOfService}
        setOos={setOutOfService}
        oosSince={oosSince}
        setOosSince={setOosSince}
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
          {mut.isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onDone}
        >
          Cancel
        </button>
      </div>
    </div>
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
        <h2 className="h4">History</h2>
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
                <Th>Notes</Th>
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
      <Td label="Reported">{fmtDate(record.reported_date)}</Td>
      <Td label="Completed">{fmtDate(record.completed_date)}</Td>
      <Td label="Type">{record.record_type ?? "—"}</Td>
      <Td label="Repairs & tests">
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
      <Td label="Notes">
        <div style={{ whiteSpace: "pre-wrap", maxWidth: 280, overflowWrap: "break-word" }}>
          {record.notes ?? "—"}
        </div>
      </Td>
      <Td label="Technician">{record.technician ?? "—"}</Td>
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
  const [notes, setNotes] = useState(record.notes ?? "");
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
        notes: notes.trim() || null,
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
      <Td label="Reported">
        <input
          className="input"
          style={{ minWidth: 110 }}
          value={reported}
          onChange={(e) => setReported(e.target.value)}
          placeholder="YYYY-MM-DD"
        />
      </Td>
      <Td label="Completed">
        <input
          className="input"
          style={{ minWidth: 110 }}
          value={completed}
          onChange={(e) => setCompleted(e.target.value)}
          placeholder="YYYY-MM-DD"
        />
      </Td>
      <Td label="Type">
        <input
          className="input"
          value={recordType}
          onChange={(e) => setRecordType(e.target.value)}
        />
      </Td>
      <Td label="Repairs & tests">
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
      <Td label="Notes">
        <textarea
          className="input"
          rows={3}
          style={{ minWidth: 220 }}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes"
        />
      </Td>
      <Td label="Technician">
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
  const [last92, setLast92] = useState("");
  const [last368, setLast368] = useState("");
  const [last1104, setLast1104] = useState("");
  const [outOfService, setOutOfService] = useState(false);
  const [oosSince, setOosSince] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      createAsset({
        reporting_mark: reportingMark.trim(),
        road_number: roadNumber.trim(),
        unit_model: unitModel.trim(),
        in_service_date: inService.trim() || undefined,
        last_92_day_at: last92.trim() || undefined,
        last_368_day_at: last368.trim() || undefined,
        last_1104_day_at: last1104.trim() || undefined,
        out_of_service: outOfService,
        oos_since: outOfService ? oosSince.trim() || undefined : undefined,
      }),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      // Fleet change → re-check which manuals are relevant to the org's models.
      qc.invalidateQueries({ queryKey: ["corpus-documents"] });
      onAdded(a);
      setReportingMark("");
      setRoadNumber("");
      setUnitModel("");
      setInService("");
      setLast92("");
      setLast368("");
      setLast1104("");
      setOutOfService(false);
      setOosSince("");
      setOpen(false);
    },
  });

  const canSubmit =
    !!reportingMark.trim() && !!roadNumber.trim() && !!unitModel.trim();

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-sm"
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
      <InspectionFields
        last92={last92}
        setLast92={setLast92}
        last368={last368}
        setLast368={setLast368}
        last1104={last1104}
        setLast1104={setLast1104}
        oos={outOfService}
        setOos={setOutOfService}
        oosSince={oosSince}
        setOosSince={setOosSince}
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
  const [notes, setNotes] = useState("");

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
        notes: notes.trim() || null,
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
      setNotes("");
      setOpen(false);
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-sm"
        style={{ marginBottom: 12, width: "100%" }}
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
      <textarea
        className="input"
        placeholder="Notes"
        rows={3}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
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

function Td({
  children,
  label,
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <td data-label={label} style={{ padding: "10px 12px" }}>
      {children}
    </td>
  );
}
