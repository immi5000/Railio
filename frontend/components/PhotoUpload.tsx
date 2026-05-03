"use client";

import { useCallback, useRef, useState } from "react";
import { uploadPhotos, fileUrl } from "@/lib/api";
import type { Attachment } from "@/lib/contract";

export type PendingAttachment = Attachment & { localUrl?: string };

export function PhotoUpload({
  ticketId,
  pending,
  onAdd,
  onRemove,
  compact,
}: {
  ticketId: number;
  pending: PendingAttachment[];
  onAdd: (a: PendingAttachment[]) => void;
  onRemove: (path: string) => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setBusy(true);
      setError(null);
      try {
        const { attachments } = await uploadPhotos(ticketId, files);
        // Pair locally previewable URLs by index where possible
        const enriched = attachments.map((a, i) => ({
          ...a,
          localUrl: files[i] ? URL.createObjectURL(files[i]) : undefined,
        }));
        onAdd(enriched);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setBusy(false);
      }
    },
    [onAdd, ticketId],
  );

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const files = Array.from(e.dataTransfer.files).filter((f) =>
            f.type.startsWith("image/"),
          );
          if (files.length) handleFiles(files);
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files).filter((f) =>
            f.type.startsWith("image/"),
          );
          if (files.length) handleFiles(files);
        }}
        style={{
          border: "1px dashed var(--border)",
          padding: compact ? 8 : 16,
          background: compact ? "transparent" : "#fff",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? "Uploading..." : "+ Photo"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) handleFiles(files);
            e.target.value = "";
          }}
        />
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          Drop, paste, or click to attach images.
        </span>
        {error && (
          <span style={{ fontSize: 12, color: "#8a1f15" }}>{error}</span>
        )}
      </div>

      {pending.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 12,
          }}
        >
          {pending.map((p) => (
            <div
              key={p.path}
              style={{
                position: "relative",
                width: 72,
                height: 72,
                border: "1px solid var(--border)",
                background: "var(--pale)",
                overflow: "hidden",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.localUrl || fileUrl(p.path)}
                alt="attachment"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <button
                type="button"
                aria-label="Remove"
                onClick={() => onRemove(p.path)}
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  width: 18,
                  height: 18,
                  background: "#000",
                  color: "#fff",
                  border: 0,
                  cursor: "pointer",
                  fontSize: 11,
                  lineHeight: "18px",
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
