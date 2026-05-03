"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createTicket,
  listTickets,
  parseFaultDump,
  patchTicket,
} from "@/lib/api";
import type { ParsedFault, Ticket } from "@/lib/contract";
import { ChatPane } from "./ChatPane";
import { severityClass } from "@/lib/format";

// Until the backend exposes a /api/assets list, allow the dispatcher to
// type a unit number; we synthesize a payload aligned with CreateTicketBody.
// See contract.ts: CreateTicketBody.asset_id is required.
type AssetSeed = { id: number; reporting_mark: string; road_number: string };

export function DispatcherIntake() {
  const router = useRouter();
  const qc = useQueryClient();

  const [assetId, setAssetId] = useState<number | "">("");
  const [reportingMark, setReportingMark] = useState("");
  const [roadNumber, setRoadNumber] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [errorCodes, setErrorCodes] = useState("");
  const [faultDump, setFaultDump] = useState("");

  // Existing tickets are used to seed the asset selector with anything we already know.
  const { data: existing } = useQuery({
    queryKey: ["tickets", "all-for-asset-seed"],
    queryFn: () => listTickets(),
  });
  const knownAssets: AssetSeed[] = (existing || []).reduce<AssetSeed[]>(
    (acc, t) => {
      if (!acc.some((a) => a.id === t.asset.id)) {
        acc.push({
          id: t.asset.id,
          reporting_mark: t.asset.reporting_mark,
          road_number: t.asset.road_number,
        });
      }
      return acc;
    },
    [],
  );

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
      }),
    onSuccess: async (t) => {
      setCreatedTicket(t);
      qc.invalidateQueries({ queryKey: ["tickets"] });
      // If a fault dump was provided, parse it now (sync)
      if (faultDump.trim()) {
        await runParse(t.id);
      }
    },
  });

  async function runParse(ticketId: number) {
    setParseBusy(true);
    setParseError(null);
    try {
      const { parsed } = await parseFaultDump(ticketId, faultDump);
      setParsed(parsed);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Parse failed");
    } finally {
      setParseBusy(false);
    }
  }

  async function handoffToTech() {
    if (!createdTicket) return;
    await patchTicket(createdTicket.id, { status: "AWAITING_TECH" });
    qc.invalidateQueries({ queryKey: ["tickets"] });
    router.push("/dispatcher");
  }

  return (
    <section style={{ padding: "32px 0 96px" }}>
      <div className="wrap">
        <div style={{ marginBottom: 24 }}>
          <span className="sect-eyebrow">02 — New ticket</span>
          <h1 className="h1" style={{ marginTop: 12 }}>
            Open A Ticket
          </h1>
          <p className="lede" style={{ marginTop: 8 }}>
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
                <label className="label">Asset</label>
                {knownAssets.length > 0 && (
                  <select
                    className="select"
                    value={assetId === "" ? "" : assetId}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") {
                        setAssetId("");
                      } else {
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
                        {a.reporting_mark} {a.road_number}
                      </option>
                    ))}
                  </select>
                )}
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginTop: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <input
                    className="input"
                    style={{ flex: "1 1 140px" }}
                    placeholder="Reporting mark"
                    value={reportingMark}
                    onChange={(e) => setReportingMark(e.target.value)}
                    disabled={!!createdTicket}
                  />
                  <input
                    className="input"
                    style={{ flex: "1 1 140px" }}
                    placeholder="Road number"
                    value={roadNumber}
                    onChange={(e) => setRoadNumber(e.target.value)}
                    disabled={!!createdTicket}
                  />
                  <input
                    className="input"
                    style={{ flex: "1 1 100px", maxWidth: 160 }}
                    placeholder="Asset ID"
                    type="number"
                    value={assetId === "" ? "" : assetId}
                    onChange={(e) =>
                      setAssetId(
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    disabled={!!createdTicket}
                  />
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
                      runParse(createdTicket.id);
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
                      onClick={() => runParse(createdTicket.id)}
                      disabled={parseBusy || !faultDump.trim()}
                    >
                      {parseBusy ? "Parsing…" : "Parse fault dump"}
                    </button>
                  )}
                  {parseError && (
                    <span style={{ color: "#8a1f15", fontSize: 12 }}>
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
                  borderTop: "1px solid var(--pale)",
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
                      Ticket #{createdTicket.id} opened
                    </span>
                    <button className="btn btn-primary" onClick={handoffToTech}>
                      Hand off to tech →
                    </button>
                  </>
                )}
              </div>
              {createMut.error && (
                <div style={{ color: "#8a1f15", fontSize: 13 }}>
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
                    ticketId={createdTicket.id}
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
                    color: "var(--muted)",
                    background: "var(--pale)",
                    borderStyle: "dashed",
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
    </section>
  );
}
