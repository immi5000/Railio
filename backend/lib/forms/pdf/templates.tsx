import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type {
  F6180_49A,
  DailyInspection_229_21,
} from "@contract/contract";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  hdr: {
    borderBottomWidth: 1.5,
    borderColor: "#000",
    paddingBottom: 6,
    marginBottom: 10,
  },
  hdrTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  agency: { fontSize: 9, fontWeight: 700 },
  formNo: { fontSize: 10, fontWeight: 700 },
  title: { fontSize: 14, fontWeight: 700, marginTop: 4 },
  subtitle: { fontSize: 8, color: "#444", marginTop: 2 },
  notice: { fontSize: 7, color: "#666", marginTop: 4, fontStyle: "italic" },
  sect: {
    backgroundColor: "#000",
    color: "#fff",
    fontSize: 9,
    fontWeight: 700,
    padding: "3 6",
    marginTop: 10,
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: { flexDirection: "row", marginBottom: 3 },
  k: { width: 130, color: "#444" },
  v: { flex: 1 },
  grid2: { flexDirection: "row", gap: 12, marginBottom: 3 },
  cell: { flex: 1 },
  cellK: { fontSize: 7, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 },
  cellV: { fontSize: 10, borderBottomWidth: 0.5, borderColor: "#888", paddingBottom: 1 },
  table: { borderWidth: 0.5, borderColor: "#000", marginTop: 4 },
  trH: {
    flexDirection: "row",
    backgroundColor: "#eee",
    borderBottomWidth: 0.5,
    borderColor: "#000",
  },
  tr: { flexDirection: "row", borderBottomWidth: 0.3, borderColor: "#ccc" },
  td: { padding: 3, borderRightWidth: 0.3, borderColor: "#ccc", fontSize: 8 },
  tdH: { padding: 3, borderRightWidth: 0.5, borderColor: "#000", fontSize: 8, fontWeight: 700 },
  pill: {
    paddingTop: 1,
    paddingBottom: 1,
    paddingLeft: 5,
    paddingRight: 5,
    fontSize: 8,
    fontWeight: 700,
    borderRadius: 2,
    color: "#fff",
  },
  small: { fontSize: 7, color: "#888", marginTop: 16, textAlign: "center" },
  sigBlock: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: "#000",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sigLine: { width: 240, borderBottomWidth: 0.5, borderColor: "#000", height: 18 },
});

const KV = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <View style={s.row}>
    <Text style={s.k}>{k}</Text>
    <Text style={s.v}>{(v as any) ?? "—"}</Text>
  </View>
);

const Cell = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <View style={s.cell}>
    <Text style={s.cellK}>{label}</Text>
    <Text style={s.cellV}>{(value as any) || " "}</Text>
  </View>
);

function ResultBadge({ result }: { result: "pass" | "fail" | "na" }) {
  const bg = result === "pass" ? "#1f7a3a" : result === "fail" ? "#a31b1b" : "#888";
  const label = result === "pass" ? "PASS" : result === "fail" ? "FAIL" : "N/A";
  return <Text style={[s.pill, { backgroundColor: bg }]}>{label}</Text>;
}

const INSPECTION_TYPE_LABEL: Record<F6180_49A["inspection_type"], string> = {
  "92_day": "92-Day Periodic Inspection",
  annual: "Annual Inspection",
  biennial: "Biennial Inspection",
  after_repair: "After-Repair Inspection",
};

export function F6180_49A_Doc({ p }: { p: F6180_49A }) {
  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <View style={s.hdr}>
          <View style={s.hdrTop}>
            <View>
              <Text style={s.agency}>U.S. DEPARTMENT OF TRANSPORTATION</Text>
              <Text style={s.agency}>FEDERAL RAILROAD ADMINISTRATION</Text>
            </View>
            <Text style={s.formNo}>FRA F 6180.49A</Text>
          </View>
          <Text style={s.title}>Locomotive Inspection and Repair Record</Text>
          <Text style={s.subtitle}>49 CFR Part 229 — Subpart B</Text>
          <Text style={s.notice}>
            This form is rendered by Railio for demo purposes. Production use should fill the official
            FRA blank PDF (OMB control number 2130-0004).
          </Text>
        </View>

        <Text style={s.sect}>A. Locomotive Identification</Text>
        <View style={s.grid2}>
          <Cell label="Reporting mark" value={p.reporting_mark} />
          <Cell label="Road number" value={p.road_number} />
          <Cell label="Unit model" value={p.unit_model} />
          <Cell label="Build date" value={p.build_date ?? ""} />
        </View>

        <Text style={s.sect}>B. Inspection Details</Text>
        <View style={s.grid2}>
          <Cell label="Inspection type" value={INSPECTION_TYPE_LABEL[p.inspection_type]} />
          <Cell label="Inspection date" value={p.inspection_date} />
          <Cell label="Previous inspection" value={p.previous_inspection_date ?? ""} />
        </View>
        <View style={s.grid2}>
          <Cell label="Place inspected" value={p.place_inspected} />
          <Cell label="Inspector name" value={p.inspector_name} />
          <Cell label="Qualification" value={p.inspector_qualification ?? ""} />
        </View>

        {p.items.length > 0 && (
          <>
            <Text style={s.sect}>C. Inspection Items</Text>
            <View style={s.table}>
              <View style={s.trH}>
                <Text style={[s.tdH, { flex: 1 }]}>CFR §</Text>
                <Text style={[s.tdH, { flex: 4 }]}>Item</Text>
                <Text style={[s.tdH, { flex: 1 }]}>Result</Text>
                <Text style={[s.tdH, { flex: 3, borderRightWidth: 0 }]}>Note</Text>
              </View>
              {p.items.map((it, i) => (
                <View key={i} style={s.tr}>
                  <Text style={[s.td, { flex: 1 }]}>{it.code}</Text>
                  <Text style={[s.td, { flex: 4 }]}>{it.label}</Text>
                  <View style={[s.td, { flex: 1 }]}>
                    <ResultBadge result={it.result} />
                  </View>
                  <Text style={[s.td, { flex: 3, borderRightWidth: 0 }]}>{it.note ?? ""}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={s.sect}>D. Defects Discovered</Text>
        {p.defects.length === 0 ? (
          <Text>None recorded.</Text>
        ) : (
          <View style={s.table}>
            <View style={s.trH}>
              <Text style={[s.tdH, { flex: 1 }]}>FRA §</Text>
              <Text style={[s.tdH, { flex: 4 }]}>Description</Text>
              <Text style={[s.tdH, { flex: 2 }]}>Location</Text>
              <Text style={[s.tdH, { flex: 1, borderRightWidth: 0 }]}>Severity</Text>
            </View>
            {p.defects.map((d, i) => (
              <View key={i} style={s.tr}>
                <Text style={[s.td, { flex: 1 }]}>{d.fra_part}</Text>
                <Text style={[s.td, { flex: 4 }]}>{d.description}</Text>
                <Text style={[s.td, { flex: 2 }]}>{d.location}</Text>
                <Text style={[s.td, { flex: 1, borderRightWidth: 0 }]}>{d.severity}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={s.sect}>E. Repairs Performed</Text>
        {p.repairs.length === 0 ? (
          <Text>None recorded.</Text>
        ) : (
          <View style={s.table}>
            <View style={s.trH}>
              <Text style={[s.tdH, { flex: 4 }]}>Description</Text>
              <Text style={[s.tdH, { flex: 3 }]}>Parts replaced</Text>
              <Text style={[s.tdH, { flex: 2, borderRightWidth: 0 }]}>Completed</Text>
            </View>
            {p.repairs.map((r, i) => (
              <View key={i} style={s.tr}>
                <Text style={[s.td, { flex: 4 }]}>{r.description}</Text>
                <Text style={[s.td, { flex: 3 }]}>{(r.parts_replaced ?? []).join(", ")}</Text>
                <Text style={[s.td, { flex: 2, borderRightWidth: 0 }]}>{r.completed_at}</Text>
              </View>
            ))}
          </View>
        )}

        {p.air_brake_test && (
          <>
            <Text style={s.sect}>F. Air-Brake Test</Text>
            <View style={s.grid2}>
              <Cell label="Test type" value={p.air_brake_test.test_type} />
              <Cell label="Result" value={p.air_brake_test.pass ? "PASS" : "FAIL"} />
            </View>
            <KV
              k="Readings"
              v={Object.entries(p.air_brake_test.readings)
                .map(([k, v]) => `${k}=${v}`)
                .join("  ·  ") || "—"}
            />
          </>
        )}

        <Text style={s.sect}>G. Status</Text>
        <KV k="Out of service" v={p.out_of_service ? "YES — bad-ordered" : "No — in service"} />
        {p.out_of_service && p.out_of_service_at && (
          <KV k="Out-of-service at" v={p.out_of_service_at} />
        )}
        {p.returned_to_service_at && (
          <KV k="Returned to service" v={p.returned_to_service_at} />
        )}

        <Text style={s.sect}>H. Certification</Text>
        <View style={s.sigBlock}>
          <View>
            <Text style={s.cellK}>Inspector signature</Text>
            <View style={s.sigLine}>
              <Text style={{ fontSize: 11, marginTop: 2 }}>{p.signature?.name ?? ""}</Text>
            </View>
          </View>
          <View>
            <Text style={s.cellK}>Date signed</Text>
            <View style={s.sigLine}>
              <Text style={{ fontSize: 11, marginTop: 2 }}>{p.signature?.signed_at ?? ""}</Text>
            </View>
          </View>
        </View>

        <Text style={s.small}>Rendered by Railio · Form layout based on FRA F 6180.49A</Text>
      </Page>
    </Document>
  );
}

export function DailyInspection_Doc({ p }: { p: DailyInspection_229_21 }) {
  const failed = p.items.filter((i) => i.result === "fail").length;
  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <View style={s.hdr}>
          <View style={s.hdrTop}>
            <View>
              <Text style={s.agency}>DAILY LOCOMOTIVE INSPECTION RECORD</Text>
              <Text style={s.subtitle}>Required by 49 CFR §229.21</Text>
            </View>
            <Text style={s.formNo}>§ 229.21</Text>
          </View>
          <Text style={s.notice}>
            One inspection per locomotive per calendar day. Performed by a qualified person.
            Defects noted shall be repaired or the locomotive removed from service per §229.9.
          </Text>
        </View>

        <Text style={s.sect}>A. Unit & Inspection</Text>
        <View style={s.grid2}>
          <Cell label="Reporting mark" value={p.unit.reporting_mark} />
          <Cell label="Road number" value={p.unit.road_number} />
          <Cell label="Unit model" value={p.unit.unit_model} />
        </View>
        <View style={s.grid2}>
          <Cell label="Inspected at" value={p.inspected_at} />
          <Cell label="Place" value={p.place_inspected ?? ""} />
          <Cell label="Previous daily" value={p.previous_daily_inspection_at ?? ""} />
        </View>
        <View style={s.grid2}>
          <Cell label="Inspector name" value={p.inspector_name} />
          <Cell label="Qualification" value={p.inspector_qualification ?? ""} />
        </View>

        <Text style={s.sect}>B. Inspection Items ({p.items.length})</Text>
        <View style={s.table}>
          <View style={s.trH}>
            <Text style={[s.tdH, { flex: 1 }]}>CFR §</Text>
            <Text style={[s.tdH, { flex: 4 }]}>Item</Text>
            <Text style={[s.tdH, { flex: 1 }]}>Result</Text>
            <Text style={[s.tdH, { flex: 3, borderRightWidth: 0 }]}>Note</Text>
          </View>
          {p.items.map((it, i) => (
            <View key={i} style={s.tr}>
              <Text style={[s.td, { flex: 1 }]}>{it.cfr_ref}</Text>
              <Text style={[s.td, { flex: 4 }]}>{it.label}</Text>
              <View style={[s.td, { flex: 1 }]}>
                <ResultBadge result={it.result} />
              </View>
              <Text style={[s.td, { flex: 3, borderRightWidth: 0 }]}>{it.note ?? ""}</Text>
            </View>
          ))}
        </View>

        <Text style={s.sect}>C. Exceptions / Bad-Order Items {failed ? `(${failed} failed)` : ""}</Text>
        {p.exceptions.length > 0 ? (
          p.exceptions.map((e, i) => (
            <Text key={i} style={{ fontSize: 9, marginBottom: 2 }}>• {e}</Text>
          ))
        ) : (
          <Text>None.</Text>
        )}

        <Text style={s.sect}>D. Certification</Text>
        <View style={s.sigBlock}>
          <View>
            <Text style={s.cellK}>Qualified person signature</Text>
            <View style={s.sigLine}>
              <Text style={{ fontSize: 11, marginTop: 2 }}>{p.signature?.name ?? ""}</Text>
            </View>
          </View>
          <View>
            <Text style={s.cellK}>Date signed</Text>
            <View style={s.sigLine}>
              <Text style={{ fontSize: 11, marginTop: 2 }}>{p.signature?.signed_at ?? ""}</Text>
            </View>
          </View>
        </View>

        <Text style={s.small}>Rendered by Railio · Checklist derived from 49 CFR §229.21 and cross-referenced sections</Text>
      </Page>
    </Document>
  );
}
