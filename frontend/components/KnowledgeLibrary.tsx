"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listCorpusDocuments, listCorpusChunks, fileUrl } from "@/lib/api";
import type { CorpusDocument, CorpusChunk } from "@/lib/contract";
import { CitationDrawer } from "./CitationDrawer";
import { techNameForChunk } from "@/lib/techNames";

// One tab per knowledge slice. Manuals split by locomotive model; shared
// reference manuals with no model (49 CFR) get their own tab; tribal is its own.
type Tab = {
  key: string;
  label: string;
  kind: "all" | "cfr" | "model" | "tribal";
  docs: CorpusDocument[];
};

function isTribal(d: CorpusDocument) {
  return d.doc_class === "tribal_knowledge";
}

function buildTabs(docs: CorpusDocument[]): Tab[] {
  const cfr: CorpusDocument[] = [];
  const tribal: CorpusDocument[] = [];
  const byModel = new Map<string, CorpusDocument[]>();

  for (const d of docs) {
    if (isTribal(d)) {
      tribal.push(d);
    } else if (d.unit_model) {
      const arr = byModel.get(d.unit_model) || [];
      arr.push(d);
      byModel.set(d.unit_model, arr);
    } else {
      // A manual with no model scope is shared federal reference → 49 CFR.
      cfr.push(d);
    }
  }

  const tabs: Tab[] = [{ key: "all", label: "All", kind: "all", docs }];
  if (cfr.length) {
    tabs.push({ key: "cfr", label: "49 CFR", kind: "cfr", docs: cfr });
  }
  for (const model of [...byModel.keys()].sort()) {
    tabs.push({
      key: `model:${model}`,
      label: model,
      kind: "model",
      docs: byModel.get(model)!,
    });
  }
  if (tribal.length) {
    tabs.push({ key: "tribal", label: "Tribal", kind: "tribal", docs: tribal });
  }
  return tabs;
}

export function KnowledgeLibrary() {
  const [active, setActive] = useState("all");
  const [q, setQ] = useState("");
  const [openChunk, setOpenChunk] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["corpus-documents"],
    queryFn: () => listCorpusDocuments(),
  });

  const filtered = useMemo(() => {
    const docs = data || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return docs;
    return docs.filter((d) =>
      `${d.doc_title} ${d.doc_id} ${d.unit_model || ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [data, q]);

  const tabs = useMemo(() => buildTabs(filtered), [filtered]);
  const activeTab = tabs.find((t) => t.key === active) || tabs[0];

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
          regulation; tribal notes are the senior techs&apos; own knowledge. Open
          a manual to read the exact document Railio cites.
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
            placeholder="Search documents…"
          />
          <div style={{ display: "inline-flex", flexWrap: "wrap", gap: 6 }}>
            {tabs.map((t) => (
              <FilterButton
                key={t.key}
                label={`${tabIcon(t.kind)}${t.label} · ${t.docs.length}`}
                active={activeTab?.key === t.key}
                onClick={() => setActive(t.key)}
              />
            ))}
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
              Could not load documents from{" "}
              <code>{process.env.NEXT_PUBLIC_API_BASE}</code>. Make sure the
              backend exposes <code>GET /api/corpus/documents</code>.
            </p>
          </div>
        )}
        {data && filtered.length === 0 && (
          <div className="card" style={{ color: "var(--dash-muted)" }}>
            No documents match.
          </div>
        )}

        {activeTab && activeTab.docs.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {activeTab.docs.map((d) => (
              <DocCard
                key={`${d.doc_class}:${d.unit_model || ""}:${d.doc_id}`}
                doc={d}
                onOpenChunk={(id) => setOpenChunk(id)}
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

function DocCard({
  doc,
  onOpenChunk,
}: {
  doc: CorpusDocument;
  onOpenChunk: (chunkId: number) => void;
}) {
  const tribal = isTribal(doc);
  const [expanded, setExpanded] = useState(false);
  // Tribal notes have no external document — clicking expands to the notes
  // inline (the "full text" is the source). Manuals/CFR open their source doc.
  const href = doc.source_url ? (fileUrl(doc.source_url) ?? doc.source_url) : null;
  const eyebrow = tribal
    ? "👤 Tribal knowledge"
    : doc.unit_model
      ? `🚂 ${doc.unit_model}`
      : "§ 49 CFR";
  const countLabel = `${doc.chunk_count} ${tribal ? "note" : "section"}${
    doc.chunk_count === 1 ? "" : "s"
  }${doc.page_count ? ` · ${doc.page_count} pages` : ""}`;

  const Header = (
    <>
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
          {eyebrow}
        </div>
        <h3 className="h4" style={{ fontSize: 18 }}>
          {doc.doc_title}
        </h3>
        <div
          style={{
            fontSize: 12,
            color: "var(--dash-muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            marginTop: 4,
          }}
        >
          {doc.doc_id} · {countLabel}
        </div>
      </div>
      <span
        style={{
          color: "var(--dash-link)",
          fontSize: 14,
          alignSelf: "center",
          whiteSpace: "nowrap",
        }}
      >
        {href
          ? doc.doc_id.startsWith("cfr_")
            ? "Open in eCFR ↗"
            : "Open manual ↗"
          : expanded
            ? "Hide notes ▾"
            : "View notes ▸"}
      </span>
    </>
  );

  const headerStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 20px",
    background: tribal ? "#e2eaf7" : "var(--dash-bg)",
    gap: 16,
    flexWrap: "wrap",
  };

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
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          style={{ ...headerStyle, textDecoration: "none", color: "inherit" }}
        >
          {Header}
        </a>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            ...headerStyle,
            width: "100%",
            appearance: "none",
            border: 0,
            cursor: "pointer",
            font: "inherit",
            textAlign: "left",
          }}
        >
          {Header}
        </button>
      )}

      {!href && expanded && (
        <TribalNotes doc={doc} onOpenChunk={onOpenChunk} />
      )}
    </div>
  );
}

function TribalNotes({
  doc,
  onOpenChunk,
}: {
  doc: CorpusDocument;
  onOpenChunk: (chunkId: number) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["corpus-doc-chunks", doc.doc_id],
    queryFn: () => listCorpusChunks({ doc_id: doc.doc_id, limit: 500 }),
  });

  if (isLoading) {
    return (
      <div style={{ padding: "14px 20px", color: "var(--dash-muted)" }}>
        <span className="micro">Loading notes…</span>
      </div>
    );
  }

  return (
    <div>
      {(data || []).map((c: CorpusChunk) => {
        const author = techNameForChunk(c);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onOpenChunk(c.id)}
            style={{
              appearance: "none",
              background: "#fff",
              border: 0,
              borderTop: "1px solid var(--dash-line)",
              padding: "14px 20px",
              width: "100%",
              textAlign: "left",
              cursor: "pointer",
              fontFamily: "inherit",
              display: "block",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "var(--dash-bg)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background = "#fff")
            }
          >
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
            <div
              style={{
                fontSize: 13,
                color: "#3a3a3e",
                lineHeight: 1.55,
                marginTop: 6,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
              }}
            >
              {c.text}
            </div>
          </button>
        );
      })}
    </div>
  );
}
