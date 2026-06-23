"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listCorpusChunks, fileUrl } from "@/lib/api";
import type { CorpusChunk } from "@/lib/contract";
import { CitationDrawer } from "./CitationDrawer";
import { techNameForChunk } from "@/lib/techNames";

type DocGroup = {
  doc_id: string;
  doc_title: string;
  chunks: CorpusChunk[];
};

// One tab per knowledge slice. Manuals split by locomotive model; shared
// reference manuals with no model (49 CFR) get their own tab; tribal is its own.
type Tab = {
  key: string;
  label: string;
  kind: "all" | "cfr" | "model" | "tribal";
  chunks: CorpusChunk[];
};

function isTribal(c: CorpusChunk) {
  return c.doc_class === "tribal_knowledge";
}

function buildTabs(chunks: CorpusChunk[]): Tab[] {
  const cfr: CorpusChunk[] = [];
  const tribal: CorpusChunk[] = [];
  const byModel = new Map<string, CorpusChunk[]>();

  for (const c of chunks) {
    if (isTribal(c)) {
      tribal.push(c);
    } else if (c.unit_model) {
      const arr = byModel.get(c.unit_model) || [];
      arr.push(c);
      byModel.set(c.unit_model, arr);
    } else {
      // A manual with no model scope is shared federal reference → 49 CFR.
      cfr.push(c);
    }
  }

  const tabs: Tab[] = [
    { key: "all", label: "All", kind: "all", chunks },
  ];
  if (cfr.length) {
    tabs.push({ key: "cfr", label: "49 CFR", kind: "cfr", chunks: cfr });
  }
  for (const model of [...byModel.keys()].sort()) {
    tabs.push({
      key: `model:${model}`,
      label: model,
      kind: "model",
      chunks: byModel.get(model)!,
    });
  }
  if (tribal.length) {
    tabs.push({ key: "tribal", label: "Tribal", kind: "tribal", chunks: tribal });
  }
  return tabs;
}

function figureCount(chunks: CorpusChunk[]): number {
  return chunks.reduce((n, c) => n + (c.figures?.length || 0), 0);
}

export function KnowledgeLibrary() {
  const [active, setActive] = useState("all");
  const [q, setQ] = useState("");
  const [openChunk, setOpenChunk] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["corpus", q],
    queryFn: () => listCorpusChunks({ q: q || undefined, limit: 2000 }),
  });

  const tabs = useMemo(() => buildTabs(data || []), [data]);
  const activeTab = tabs.find((t) => t.key === active) || tabs[0];
  const groups: DocGroup[] = useMemo(
    () => groupByDoc(activeTab?.chunks || []),
    [activeTab],
  );

  return (
    <div className="dash">
      <div className="dash-inner" style={{ paddingBottom: 64, gap: 0 }}>
        <span className="sect-eyebrow">Knowledge library</span>
        <h1 className="h2" style={{ marginTop: 12 }}>
          What Railio cites
        </h1>
        <p
          style={{
            color: "var(--dash-muted)",
            marginTop: 8,
            maxWidth: 720,
            fontSize: 14,
          }}
        >
          Every answer the assistant gives is grounded in one of these sources.
          Manuals are organized by locomotive model; 49 CFR is shared federal
          regulation; tribal notes are the senior techs&apos; own knowledge. Each
          chunk shows the exact page and PDF it came from, so you can verify it.
        </p>

        <div
          style={{
            display: "flex",
            gap: 12,
            marginTop: 24,
            marginBottom: 16,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <input
            className="input"
            style={{ maxWidth: 380 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search across all sources…"
          />
          <div
            style={{
              display: "inline-flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {tabs.map((t) => {
              const figs = figureCount(t.chunks);
              return (
                <FilterButton
                  key={t.key}
                  label={`${tabIcon(t.kind)}${t.label} · ${t.chunks.length}${
                    figs ? ` · ${figs}🖼` : ""
                  }`}
                  active={activeTab?.key === t.key}
                  onClick={() => setActive(t.key)}
                />
              );
            })}
          </div>
        </div>

        {isLoading && (
          <div className="card" style={{ color: "var(--dash-muted)" }}>
            <span className="micro">Loading library…</span>
          </div>
        )}
        {error && (
          <div className="card" style={{ borderColor: "#e9b8b2" }}>
            <span className="micro" style={{ color: "#c0392b" }}>
              Backend unreachable
            </span>
            <p style={{ marginTop: 8, fontSize: 14 }}>
              Could not load corpus chunks from{" "}
              <code>{process.env.NEXT_PUBLIC_API_BASE}</code>. Make sure the
              backend exposes <code>GET /api/corpus/chunks</code>.
            </p>
          </div>
        )}
        {data && data.length === 0 && (
          <div className="card" style={{ color: "var(--dash-muted)" }}>
            No chunks match.
          </div>
        )}

        {groups.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {groups.map((g) => (
              <DocBlock
                key={`${g.doc_id}`}
                group={g}
                onOpen={(id) => setOpenChunk(id)}
              />
            ))}
          </div>
        )}
      </div>

      {openChunk != null && (
        <CitationDrawer chunkId={openChunk} onClose={() => setOpenChunk(null)} />
      )}
    </div>
  );
}

function tabIcon(kind: Tab["kind"]): string {
  if (kind === "cfr") return "§ ";
  if (kind === "model") return "🚂 ";
  if (kind === "tribal") return "👤 ";
  return "";
}

function FilterButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        appearance: "none",
        background: active ? "#000" : "#fff",
        color: active ? "#fff" : "#3a3a3e",
        border: `1px solid ${active ? "#000" : "var(--dash-border)"}`,
        borderRadius: 99,
        padding: "7px 14px",
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 11,
        fontWeight: 400,
        letterSpacing: 0,
        cursor: "pointer",
        transition: "border-color 0.1s, background 0.1s",
      }}
    >
      {label}
    </button>
  );
}

function DocBlock({
  group,
  onOpen,
}: {
  group: DocGroup;
  onOpen: (chunkId: number) => void;
}) {
  const tribal = isTribal(group.chunks[0]);
  const figs = figureCount(group.chunks);
  const model = group.chunks[0]?.unit_model;
  return (
    <div
      style={{
        border: `1px solid ${tribal ? "#cfddf3" : "var(--dash-card-border)"}`,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 1px 2px rgba(16, 24, 40, 0.04)",
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          padding: "16px 20px",
          background: tribal ? "#e2eaf7" : "var(--dash-bg)",
          borderBottom: `1px solid ${tribal ? "#cfddf3" : "var(--dash-line)"}`,
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: tribal ? "var(--dash-link)" : "var(--dash-muted)",
              marginBottom: 4,
            }}
          >
            {tribal
              ? "👤 Tribal knowledge"
              : model
              ? `🚂 ${model}`
              : "§ 49 CFR"}
          </div>
          <h3 className="h4" style={{ fontSize: 18 }}>
            {group.doc_title}
          </h3>
          <div
            style={{
              fontSize: 12,
              color: "var(--dash-muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              marginTop: 4,
            }}
          >
            {group.doc_id}
          </div>
        </div>
        <span className="micro" style={{ color: "var(--dash-muted)" }}>
          {group.chunks.length} chunk
          {group.chunks.length === 1 ? "" : "s"}
          {figs ? ` · ${figs} figure${figs === 1 ? "" : "s"}` : ""}
        </span>
      </div>
      <div>
        {group.chunks.map((c) => {
          const author = tribal ? techNameForChunk(c) : null;
          const nFigs = c.figures?.length || 0;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpen(c.id)}
              className="form-item-row"
              style={{
                appearance: "none",
                background: "#fff",
                border: 0,
                borderBottom: "1px solid var(--dash-line)",
                padding: "14px 20px",
                width: "100%",
                textAlign: "left",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "background 0.1s",
                display: "grid",
                gridTemplateColumns: "200px 1fr 24px",
                gap: 16,
                alignItems: "start",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background =
                  "var(--dash-bg)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background = "#fff")
              }
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "#3a3a3e",
                  }}
                >
                  {c.source_label}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--dash-muted)",
                    marginTop: 4,
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                  }}
                >
                  {c.page != null ? `Page ${c.page}` : "Unpaginated"} · {c.doc_id}
                </div>
                {nFigs > 0 && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "#3a3a3e",
                      marginTop: 4,
                      fontWeight: 700,
                    }}
                  >
                    🖼 {nFigs} figure{nFigs === 1 ? "" : "s"}
                  </div>
                )}
                {author && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--dash-link)",
                      marginTop: 4,
                      fontWeight: 700,
                    }}
                  >
                    By {author.name}
                    <span
                      style={{
                        color: "var(--dash-muted)",
                        fontWeight: 400,
                        marginLeft: 4,
                      }}
                    >
                      · {author.shift}
                    </span>
                  </div>
                )}
              </div>
              <div>
                <div
                  style={{
                    fontSize: 13,
                    color: "#3a3a3e",
                    lineHeight: 1.55,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {c.text}
                </div>
                {nFigs > 0 && (
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginTop: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    {c.figures.slice(0, 4).map((f, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={fileUrl(f.path)}
                        alt={f.figure_label || f.caption || "figure"}
                        style={{
                          height: 56,
                          width: "auto",
                          border: "1px solid var(--dash-card-border)",
                          background: "#fff",
                          objectFit: "contain",
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
              <span
                style={{
                  color: "var(--dash-link)",
                  fontSize: 14,
                  alignSelf: "center",
                  textAlign: "right",
                }}
              >
                →
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function groupByDoc(chunks: CorpusChunk[]): DocGroup[] {
  const map = new Map<string, DocGroup>();
  for (const c of chunks) {
    const key = `${c.doc_class}::${c.unit_model || ""}::${c.doc_id}`;
    let g = map.get(key);
    if (!g) {
      g = { doc_id: c.doc_id, doc_title: c.doc_title, chunks: [] };
      map.set(key, g);
    }
    g.chunks.push(c);
  }
  return [...map.values()].sort((a, b) =>
    a.doc_title.localeCompare(b.doc_title),
  );
}
