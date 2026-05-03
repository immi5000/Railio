"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listCorpusChunks } from "@/lib/api";
import type { CorpusChunk, DocClass } from "@/lib/contract";
import { CitationDrawer } from "./CitationDrawer";

type DocGroup = {
  doc_id: string;
  doc_title: string;
  doc_class: DocClass;
  chunks: CorpusChunk[];
};

export function KnowledgeLibrary() {
  const [filter, setFilter] = useState<DocClass | "all">("all");
  const [q, setQ] = useState("");
  const [openChunk, setOpenChunk] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["corpus", filter, q],
    queryFn: () =>
      listCorpusChunks({
        doc_class: filter === "all" ? undefined : filter,
        q: q || undefined,
        limit: 500,
      }),
  });

  const groups: DocGroup[] = useMemo(() => groupByDoc(data || []), [data]);
  const totals = useMemo(() => {
    let manual = 0;
    let tribal = 0;
    for (const c of data || []) {
      if (c.doc_class === "manual") manual++;
      else tribal++;
    }
    return { manual, tribal, all: (data || []).length };
  }, [data]);

  return (
    <section style={{ padding: "32px 0 96px" }}>
      <div className="wrap">
        <span className="sect-eyebrow">Knowledge library</span>
        <h1 className="h2" style={{ marginTop: 12 }}>
          What Railio Cites
        </h1>
        <p
          style={{
            color: "var(--muted)",
            marginTop: 8,
            maxWidth: 720,
            fontSize: 14,
          }}
        >
          Every answer the assistant gives is grounded in one of these sources.
          Each citation in a chat bubble links straight back to the underlying
          chunk on this page — manuals are neutral-bordered, tribal notes are
          blue.
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
              border: "1px solid var(--ink)",
              background: "#fff",
            }}
          >
            <FilterButton
              label={`All · ${totals.all}`}
              active={filter === "all"}
              onClick={() => setFilter("all")}
            />
            <FilterButton
              label={`📖 Manuals · ${totals.manual}`}
              active={filter === "manual"}
              onClick={() => setFilter("manual")}
            />
            <FilterButton
              label={`👤 Tribal · ${totals.tribal}`}
              active={filter === "tribal_knowledge"}
              onClick={() => setFilter("tribal_knowledge")}
            />
          </div>
        </div>

        {isLoading && (
          <div className="card" style={{ color: "var(--muted)" }}>
            <span className="micro">Loading library…</span>
          </div>
        )}
        {error && (
          <div className="card" style={{ borderColor: "#f08d80" }}>
            <span className="micro" style={{ color: "#8a1f15" }}>
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
          <div className="card" style={{ color: "var(--muted)" }}>
            No chunks match.
          </div>
        )}

        {groups.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {groups.map((g) => (
              <DocBlock
                key={`${g.doc_class}-${g.doc_id}`}
                group={g}
                onOpen={(id) => setOpenChunk(id)}
              />
            ))}
          </div>
        )}
      </div>

      {openChunk != null && (
        <CitationDrawer
          chunkId={openChunk}
          onClose={() => setOpenChunk(null)}
        />
      )}
    </section>
  );
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
        color: active ? "#fff" : "#000",
        border: 0,
        borderRight: "1px solid var(--ink)",
        padding: "10px 16px",
        fontSize: 12,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        cursor: "pointer",
        fontFamily: "inherit",
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
  const isTribal = group.doc_class === "tribal_knowledge";
  return (
    <div
      style={{
        border: `1px solid ${isTribal ? "var(--mta)" : "var(--border)"}`,
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          padding: "16px 20px",
          background: isTribal ? "var(--mta-soft)" : "var(--pale)",
          borderBottom: `1px solid ${isTribal ? "var(--mta)" : "var(--border)"}`,
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
              color: isTribal ? "var(--mta)" : "var(--muted)",
              marginBottom: 4,
            }}
          >
            {isTribal ? "👤 Tribal knowledge" : "📖 Manual"}
          </div>
          <h3 className="h4" style={{ fontSize: 18 }}>
            {group.doc_title}
          </h3>
          <div
            style={{
              fontSize: 12,
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              marginTop: 4,
            }}
          >
            {group.doc_id}
          </div>
        </div>
        <span className="micro" style={{ color: "var(--muted)" }}>
          {group.chunks.length} chunk
          {group.chunks.length === 1 ? "" : "s"}
        </span>
      </div>
      <div>
        {group.chunks.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onOpen(c.id)}
            className="form-item-row"
            style={{
              appearance: "none",
              background: "#fff",
              border: 0,
              borderBottom: "1px solid var(--pale)",
              padding: "14px 20px",
              width: "100%",
              textAlign: "left",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "background 0.1s",
              display: "grid",
              gridTemplateColumns: "180px 1fr 24px",
              gap: 16,
              alignItems: "start",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "var(--pale)")
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
                  color: "var(--ink-2)",
                }}
              >
                {c.source_label}
              </div>
              {c.page != null && (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    marginTop: 4,
                  }}
                >
                  Page {c.page}
                </div>
              )}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--ink-2)",
                lineHeight: 1.55,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
              }}
            >
              {c.text}
            </div>
            <span
              style={{
                color: "var(--mta)",
                fontSize: 14,
                alignSelf: "center",
                textAlign: "right",
              }}
            >
              →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function groupByDoc(chunks: CorpusChunk[]): DocGroup[] {
  const map = new Map<string, DocGroup>();
  for (const c of chunks) {
    const key = `${c.doc_class}::${c.doc_id}`;
    let g = map.get(key);
    if (!g) {
      g = {
        doc_id: c.doc_id,
        doc_title: c.doc_title,
        doc_class: c.doc_class,
        chunks: [],
      };
      map.set(key, g);
    }
    g.chunks.push(c);
  }
  // Sort: manuals first, then tribal; within each, alphabetical by title.
  return [...map.values()].sort((a, b) => {
    if (a.doc_class !== b.doc_class) {
      return a.doc_class === "manual" ? -1 : 1;
    }
    return a.doc_title.localeCompare(b.doc_title);
  });
}
