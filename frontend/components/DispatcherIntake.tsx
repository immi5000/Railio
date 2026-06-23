"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createAsset,
  createTicket,
  listAssets,
  listKnowledgeModels,
  parseFaultDump,
  patchTicket,
} from "@/lib/api";
import type { Asset, ParsedFault, Severity, Ticket } from "@/lib/contract";
import { ChatPane } from "./ChatPane";
import { severityClass } from "@/lib/format";

export function DispatcherIntake() {
  const router = useRouter();
  const qc = useQueryClient();

  const [assetId, setAssetId] = useState<number | "">("");
  const [reportingMark, setReportingMark] = useState("");
  const [roadNumber, setRoadNumber] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [errorCodes, setErrorCodes] = useState("");
  const [faultDump, setFaultDump] = useState("");
  const [severity, setSeverity] = useState<Severity>("major");
  const [addingAsset, setAddingAsset] = useState(false);
  const [newUnitModel, setNewUnitModel] = useState("");
  // Escape hatch: a model with no ingested manual yet (free-text entry).
  const [modelIsOther, setModelIsOther] = useState(false);

  // The fleet roster is the source of truth for the asset selector.
  const { data: assets } = useQuery({
    queryKey: ["assets"],
    queryFn: () => listAssets(),
  });
  const knownAssets: Asset[] = assets || [];

  // Models that have ingested knowledge — the add-asset model picker binds the
  // asset's unit_model directly to one of these, so the ticket scope always
  // resolves to the right manual.
  const { data: models } = useQuery({
    queryKey: ["knowledge-models"],
    queryFn: () => listKnowledgeModels(),
  });
  const knownModels = models || [];

  const addAssetMut = useMutation({
    mutationFn: () =>
      createAsset({
        reporting_mark: reportingMark.trim(),
        road_number: roadNumber.trim(),
        unit_model: newUnitModel.trim(),
      }),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      setAssetId(a.id);
      setReportingMark(a.reporting_mark);
      setRoadNumber(a.road_number);
      setAddingAsset(false);
    },
  });

  const [createdTicket, setCreatedTicket] = useState<Ticket | null>(null);
  const [parsed, setParsed] = useState<ParsedFault[] | null>(null);
  const [parseBusy, setParseBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () =>
      createTicket({
        asset_id: typeof assetId === "number" ? assetId : Number(assetId),
        opened_by_role: "dispatcher",
        initial_symptoms: symptoms || undefined,
        initial_error_codes: errorCodes || undefined,
        fault_dump_raw: faultDump || undefined,
        severity,
      }),
    onSuccess: async (t) => {
      setCreatedTicket(t);
      qc.invalidateQueries({ queryKey: ["tickets"] });
      // If a fault dump was provided, parse it now (sync)
      if (faultDump.trim()) {
        await runParse(t.short_id);
      }
    },
  });

  async function runParse(ticketRef: string) {
    setParseBusy(true);
    setParseError(null);
    try {
      const { parsed } = await parseFaultDump(ticketRef, faultDump);
      setParsed(parsed);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Parse failed");
    } finally {
      setParseBusy(false);
    }
  }

  async function handoffToTech() {
    if (!createdTicket) return;
    await patchTicket(createdTicket.short_id, { status: "AWAITING_TECH" });
    qc.invalidateQueries({ queryKey: ["tickets"] });
    router.push("/work");
  }

  return (
    <div className="dash">
      <div className="dash-inner" style={{ paddingBottom: 64 }}>
        <div>
          <span className="sect-eyebrow">Dispatch · New ticket</span>
          <h1 className="h1" style={{ marginTop: "var(--s3)" }}>
            Open a ticket
          </h1>
          <p className="lede" style={{ marginTop: "var(--s2)" }}>
            Get the unit, the symptoms, and the fault dump in. The chat on the
            right wraps it into a pre-arrival briefing for the tech.
          </p>
        </div>

        <div
          className="split-2col"
          style={{
            gridTemplateColumns: "1fr 1fr",
            gap: 24,
          }}
        >
          {/* Left: structured form */}
          <div className="card">
            <span className="sect-eyebrow">Intake</span>
            <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
              <div>
                <label className="label">Locomotive</label>
                <select
                  className="select"
                  value={addingAsset ? "__add__" : assetId === "" ? "" : assetId}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__add__") {
                      setAddingAsset(true);
                      setAssetId("");
                      setReportingMark("");
                      setRoadNumber("");
                    } else if (v === "") {
                      setAddingAsset(false);
                      setAssetId("");
                    } else {
                      setAddingAsset(false);
                      const id = Number(v);
                      setAssetId(id);
                      const a = knownAssets.find((x) => x.id === id);
                      if (a) {
                        setReportingMark(a.reporting_mark);
                        setRoadNumber(a.road_number);
                      }
                    }
                  }}
                  disabled={!!createdTicket}
                >
                  <option value="">— Select a unit —</option>
                  {knownAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.reporting_mark} {a.road_number} · {a.unit_model}
                    </option>
                  ))}
                  <option value="__add__">+ Add a new locomotive…</option>
                </select>

                {addingAsset && (
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginTop: 8,
                      flexWrap: "wrap",
                      alignItems: "flex-end",
                    }}
                  >
                    <input
                      className="input"
                      style={{ flex: "1 1 120px" }}
                      placeholder="Reporting mark"
                      value={reportingMark}
                      onChange={(e) => setReportingMark(e.target.value)}
                    />
                    <input
                      className="input"
                      style={{ flex: "1 1 120px" }}
                      placeholder="Road number"
                      value={roadNumber}
                      onChange={(e) => setRoadNumber(e.target.value)}
                    />
                    {!modelIsOther ? (
                      <select
                        className="select"
                        style={{ flex: "1 1 160px" }}
                        value={newUnitModel}
                        onChange={(e) => {
                          if (e.target.value === "__other__") {
                            setModelIsOther(true);
                            setNewUnitModel("");
                          } else {
                            setNewUnitModel(e.target.value);
                          }
                        }}
                      >
                        <option value="">— Model (has manuals) —</option>
                        {knownModels.map((m) => (
                          <option key={m.model_code} value={m.model_code}>
                            {m.model_code}
                            {m.chunk_count
                              ? ` · ${m.chunk_count} chunk${
                                  m.chunk_count === 1 ? "" : "s"
                                }`
                              : " · no manual yet"}
                          </option>
                        ))}
                        <option value="__other__">Other (type manually)…</option>
                      </select>
                    ) : (
                      <input
                        className="input"
                        style={{ flex: "1 1 160px" }}
                        placeholder="Unit model (no manual yet)"
                        value={newUnitModel}
                        autoFocus
                        onChange={(e) => setNewUnitModel(e.target.value)}
                        onBlur={() => {
                          if (!newUnitModel.trim()) setModelIsOther(false);
                        }}
                      />
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={
                        addAssetMut.isPending ||
                        !reportingMark.trim() ||
                        !roadNumber.trim() ||
                        !newUnitModel.trim()
                      }
                      onClick={() => addAssetMut.mutate()}
                    >
                      {addAssetMut.isPending ? "Adding…" : "Add unit"}
                    </button>
                  </div>
                )}
                {addingAsset &&
                  !modelIsOther &&
                  newUnitModel &&
                  !knownModels.some(
                    (m) => m.model_code === newUnitModel && m.chunk_count > 0,
                  ) && (
                    <div
                      style={{ fontSize: 11, color: "var(--dash-muted)", marginTop: 6 }}
                    >
                      ⚠ This model has no ingested manual yet — Railio will only
                      have shared 49 CFR to cite for it.
                    </div>
                  )}
                {addAssetMut.error && (
                  <div style={{ color: "#c0392b", fontSize: 12, marginTop: 6 }}>
                    {(addAssetMut.error as Error).message}
                  </div>
                )}
              </div>

              <div>
                <label className="label">Severity</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(["minor", "major", "critical"] as Severity[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={
                        severity === s
                          ? severityClass(s)
                          : "pill pill-soft"
                      }
                      style={{
                        cursor: createdTicket ? "default" : "pointer",
                        opacity: createdTicket && severity !== s ? 0.5 : 1,
                        textTransform: "capitalize",
                      }}
                      onClick={() => !createdTicket && setSeverity(s)}
                      disabled={!!createdTicket}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">Symptoms</label>
                <textarea
                  className="textarea"
                  placeholder="What did the engineer report?"
                  value={symptoms}
                  onChange={(e) => setSymptoms(e.target.value)}
                  disabled={!!createdTicket}
                />
              </div>

              <div>
                <label className="label">Initial error codes</label>
                <input
                  className="input"
                  placeholder="e.g. EM-2107, AB-44"
                  value={errorCodes}
                  onChange={(e) => setErrorCodes(e.target.value)}
                  disabled={!!createdTicket}
                />
              </div>

              <div>
                <label className="label">Paste fault dump</label>
                <textarea
                  className="textarea"
                  style={{
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 12,
                    minHeight: 160,
                  }}
                  placeholder="Raw download from EM2000 / unit log..."
                  value={faultDump}
                  onChange={(e) => setFaultDump(e.target.value)}
                  onBlur={() => {
                    if (createdTicket && faultDump.trim()) {
                      runParse(createdTicket.short_id);
                    }
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginTop: 8,
                    alignItems: "center",
                  }}
                >
                  {createdTicket && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => runParse(createdTicket.short_id)}
                      disabled={parseBusy || !faultDump.trim()}
                    >
                      {parseBusy ? "Parsing…" : "Parse fault dump"}
                    </button>
                  )}
                  {parseError && (
                    <span style={{ color: "#c0392b", fontSize: 12 }}>
                      {parseError}
                    </span>
                  )}
                </div>

                {parsed && parsed.length > 0 && (
                  <div
                    style={{
                      marginTop: 12,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                    }}
                  >
                    {parsed.map((p, i) => (
                      <span
                        key={`${p.code}-${i}`}
                        className={severityClass(p.severity)}
                        title={p.description}
                      >
                        {p.code} · {p.severity}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  paddingTop: 8,
                  borderTop: "1px solid var(--dash-line)",
                }}
              >
                {!createdTicket ? (
                  <button
                    className="btn btn-super"
                    disabled={
                      createMut.isPending ||
                      !assetId ||
                      (!symptoms && !errorCodes && !faultDump)
                    }
                    onClick={() => createMut.mutate()}
                  >
                    {createMut.isPending ? "Opening…" : "Open ticket"}{" "}
                    <span className="arr">→</span>
                  </button>
                ) : (
                  <>
                    <span className="pill pill-ok">
                      Ticket {createdTicket.short_id} opened
                    </span>
                    <button className="btn btn-primary" onClick={handoffToTech}>
                      Hand off to tech →
                    </button>
                  </>
                )}
              </div>
              {createMut.error && (
                <div style={{ color: "#c0392b", fontSize: 13 }}>
                  {(createMut.error as Error).message}
                </div>
              )}
            </div>
          </div>

          {/* Right: chat panel — only enabled once the ticket exists */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span className="sect-eyebrow">Briefing chat</span>
            <div
              style={{
                marginTop: 16,
                flex: 1,
                minHeight: 600,
                display: "flex",
              }}
            >
              {createdTicket ? (
                <div style={{ flex: 1 }}>
                  <ChatPane
                    ticketId={createdTicket.short_id}
                    role="dispatcher"
                    emptyHint="Tell Railio what the engineer said. It&rsquo;ll write the pre-arrival summary for the tech."
                  />
                </div>
              ) : (
                <div
                  className="card"
                  style={{
                    flex: 1,
                    display: "grid",
                    placeItems: "center",
                    color: "var(--dash-muted)",
                    background: "var(--dash-bg)",
                    borderStyle: "dashed",
                    boxShadow: "none",
                  }}
                >
                  <div style={{ textAlign: "center", maxWidth: 320 }}>
                    <span className="micro">Chat unlocks after intake</span>
                    <p style={{ marginTop: 8, fontSize: 13 }}>
                      Open the ticket on the left, then chat here to write the
                      pre-arrival summary and tell the tech what to bring.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
