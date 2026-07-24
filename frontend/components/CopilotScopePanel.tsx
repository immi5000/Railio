"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  listAssets,
  listHistoricalRecords,
  listKnowledgeModels,
  listParts,
} from "@/lib/api";
import type { Asset } from "@/lib/contract";
import type { CopilotScope } from "@/lib/chatSession";
import { ContextPanel, Empty } from "./ContextPanel";

function unitLabel(a: Asset): string {
  return `${a.reporting_mark} ${a.road_number}`.trim();
}

// The current focus, as one line. Shown in the shell header (replacing a static
// title) so the panel doesn't repeat it. `asset` is the resolved scope.assetId.
export function scopeLabel(scope: CopilotScope, asset: Asset | null): string {
  if (asset) return `${unitLabel(asset)} · ${asset.unit_model}`;
  if (scope.unitModel) return `${scope.unitModel} (fleet-wide)`;
  return "No focus — general chat";
}

// The sidebar for the ticketless copilot. Unlike the ticket details sidebar, it
// SELECTS scope rather than displaying it: pick one unit or one model to focus
// the copilot's corpus/parts search, or select nothing for general chat. Parts
// are a lookup (a question), not a scope — searching them doesn't change what the
// copilot can see; the "Ask" affordance just drops the part into the composer.
export function CopilotScopePanel({
  scope,
  onScopeChange,
  onAskAbout,
}: {
  scope: CopilotScope;
  onScopeChange: (scope: CopilotScope) => void;
  onAskAbout: (text: string) => void;
}) {
  const { data: assets = [] } = useQuery({
    queryKey: ["assets"],
    queryFn: listAssets,
  });
  const { data: models = [] } = useQuery({
    queryKey: ["knowledge-models"],
    queryFn: listKnowledgeModels,
  });

  const selectedAsset = useMemo(
    () => assets.find((a) => a.id === scope.assetId) ?? null,
    [assets, scope.assetId],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ContextPanel title="Focus a unit" defaultOpen>
        <UnitPicker
          assets={assets}
          selectedId={scope.assetId}
          // Clicking the focused unit again clears the focus (toggle).
          onSelect={(a) =>
            onScopeChange(
              scope.assetId === a.id
                ? { assetId: null, unitModel: null }
                : { assetId: a.id, unitModel: a.unit_model },
            )
          }
        />
      </ContextPanel>

      <ContextPanel title="Focus a model">
        <ModelPicker
          models={models}
          selected={scope.assetId ? null : scope.unitModel}
          // Clicking the focused model again clears the focus (toggle).
          onSelect={(m) =>
            onScopeChange(
              !scope.assetId && scope.unitModel === m
                ? { assetId: null, unitModel: null }
                : { assetId: null, unitModel: m },
            )
          }
        />
      </ContextPanel>

      {selectedAsset && (
        <ContextPanel title="Recent history">
          <UnitHistory assetId={selectedAsset.id} />
        </ContextPanel>
      )}

      <ContextPanel title="Look up a part">
        <PartsLookup unitModel={scope.unitModel} onAskAbout={onAskAbout} />
      </ContextPanel>
    </div>
  );
}

function UnitPicker({
  assets,
  selectedId,
  onSelect,
}: {
  assets: Asset[];
  selectedId: number | null;
  onSelect: (a: Asset) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return assets;
    return assets.filter(
      (a) =>
        unitLabel(a).toLowerCase().includes(needle) ||
        a.unit_model.toLowerCase().includes(needle),
    );
  }, [assets, q]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        className="rc-input"
        placeholder="Search units…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ padding: "6px 10px", fontSize: 13 }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          maxHeight: 240,
          overflowY: "auto",
        }}
      >
        {filtered.length === 0 && <Empty>No matching units.</Empty>}
        {filtered.map((a) => {
          const on = a.id === selectedId;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelect(a)}
              aria-pressed={on}
              title={on ? "Click to clear focus" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                borderRadius: 8,
                cursor: "pointer",
                border: "1px solid transparent",
                background: on ? "rgba(38, 131, 235, 0.08)" : "transparent",
                color: on ? "var(--dash-link)" : "inherit",
                textAlign: "left",
                font: "inherit",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  flexShrink: 0,
                  background: a.out_of_service ? "#e0453a" : "#5fb85f",
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                {unitLabel(a)}
              </span>
              <span
                style={{ fontSize: 12, color: "var(--dash-muted)", marginLeft: "auto" }}
              >
                {on ? "✕ clear" : a.unit_model}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModelPicker({
  models,
  selected,
  onSelect,
}: {
  models: { model_code: string; oem: string | null; chunk_count: number }[];
  selected: string | null;
  onSelect: (m: string) => void;
}) {
  if (models.length === 0) return <Empty>No models with ingested manuals.</Empty>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {models.map((m) => {
        const on = m.model_code === selected;
        const empty = m.chunk_count === 0;
        return (
          <button
            key={m.model_code}
            type="button"
            disabled={empty}
            onClick={() => onSelect(m.model_code)}
            aria-pressed={on}
            title={
              empty
                ? "No manuals ingested for this model yet"
                : on
                  ? "Click to clear focus"
                  : undefined
            }
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 8px",
              borderRadius: 8,
              cursor: empty ? "not-allowed" : "pointer",
              opacity: empty ? 0.5 : 1,
              border: "1px solid transparent",
              background: on ? "rgba(38, 131, 235, 0.08)" : "transparent",
              color: on ? "var(--dash-link)" : "inherit",
              textAlign: "left",
              font: "inherit",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 500 }}>{m.model_code}</span>
            {m.oem && (
              <span style={{ fontSize: 12, color: "var(--dash-muted)" }}>
                {m.oem}
              </span>
            )}
            <span
              className="micro"
              style={{
                marginLeft: "auto",
                color: on ? "var(--dash-link)" : "var(--dash-faint)",
              }}
            >
              {on ? "✕ clear" : `${m.chunk_count} chunks`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function UnitHistory({ assetId }: { assetId: number }) {
  const { data: records = [], isLoading } = useQuery({
    queryKey: ["history", assetId],
    queryFn: () => listHistoricalRecords(assetId),
  });
  if (isLoading)
    return (
      <Empty>
        <span className="loading-dots">Loading</span>
      </Empty>
    );
  if (records.length === 0) return <Empty>No history on record for this unit.</Empty>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {records.slice(0, 6).map((r) => (
        <div key={r.id} style={{ fontSize: 13 }}>
          <div style={{ color: "var(--dash-muted)", fontSize: 12 }}>
            {(r.completed_date || r.reported_date || "").slice(0, 10)}
            {r.record_type ? ` · ${r.record_type}` : ""}
          </div>
          <div>{r.repairs?.[0] || r.notes || "—"}</div>
        </div>
      ))}
      <div className="micro" style={{ color: "var(--dash-faint)" }}>
        This unit&rsquo;s history is already in the copilot&rsquo;s scope.
      </div>
    </div>
  );
}

function PartsLookup({
  unitModel,
  onAskAbout,
}: {
  unitModel: string | null;
  onAskAbout: (text: string) => void;
}) {
  const [q, setQ] = useState("");
  const enabled = q.trim().length >= 2;
  const { data, isFetching } = useQuery({
    queryKey: ["parts", "copilot", unitModel, q],
    queryFn: () => listParts({ unit_model: unitModel ?? undefined, q, limit: 8 }),
    enabled,
  });
  const parts = data?.parts ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        className="rc-input"
        placeholder="Search parts by name or number…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ padding: "6px 10px", fontSize: 13 }}
      />
      {enabled && isFetching && <Empty>Searching…</Empty>}
      {enabled && !isFetching && parts.length === 0 && (
        <Empty>No parts match.</Empty>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {parts.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--dash-border)",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
            <div style={{ fontSize: 12, color: "var(--dash-muted)" }}>
              {p.part_number}
              {p.bin_location ? ` · bin ${p.bin_location}` : ""} · {p.qty_on_hand} on
              hand
              {p.lead_time_days != null ? ` · ${p.lead_time_days}d lead` : ""}
            </div>
            <button
              type="button"
              className="micro"
              onClick={() =>
                onAskAbout(`Tell me about part ${p.part_number} (${p.name}).`)
              }
              style={{
                alignSelf: "flex-start",
                marginTop: 2,
                cursor: "pointer",
                border: "none",
                background: "transparent",
                color: "var(--dash-link)",
                textDecoration: "underline",
                padding: 0,
              }}
            >
              Ask about this part
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
