"use client";

import { useQuery } from "@tanstack/react-query";
import { getCorpusChunk } from "@/lib/api";
import { techNameForChunk } from "@/lib/techNames";

export function CitationDrawer({
  chunkId,
  onClose,
}: {
  chunkId: number;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["corpus-chunk", chunkId],
    queryFn: () => getCorpusChunk(chunkId),
  });

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 24,
          }}
        >
          <span className="sect-eyebrow">Source</span>
          <button onClick={onClose} className="btn btn-ghost btn-sm">
            Close ×
          </button>
        </div>

        {isLoading && (
          <div className="micro" style={{ color: "var(--muted)" }}>
            Loading chunk…
          </div>
        )}
        {error && (
          <div style={{ color: "#8a1f15" }}>
            Failed to load citation.
          </div>
        )}
        {data && (
          <div>
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <span
                className={
                  data.doc_class === "manual" ? "cite cite-manual" : "cite cite-tribal"
                }
                style={{ cursor: "default" }}
              >
                {data.doc_class === "manual" ? "📖 Manual" : "👤 Tribal"}
              </span>
              {data.page != null && (
                <span className="micro">Page {data.page}</span>
              )}
            </div>
            <h3 className="h3" style={{ marginBottom: 8 }}>
              {data.doc_title}
            </h3>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--muted)",
                marginBottom: data.doc_class === "tribal_knowledge" ? 8 : 24,
              }}
            >
              {data.source_label}
            </div>
            {data.doc_class === "tribal_knowledge" && (() => {
              const author = techNameForChunk(data);
              return (
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--mta)",
                    marginBottom: 24,
                  }}
                >
                  By {author.name}
                  <span
                    style={{
                      color: "var(--muted)",
                      fontWeight: 400,
                      marginLeft: 6,
                    }}
                  >
                    · {author.shift}
                  </span>
                </div>
              );
            })()}
            <p
              style={{
                fontSize: 14,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {data.text}
            </p>
          </div>
        )}
      </aside>
    </>
  );
}
