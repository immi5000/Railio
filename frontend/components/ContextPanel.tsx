"use client";

import { useState } from "react";

/**
 * Collapsible context card shared by the tech RepairContext and dispatcher
 * IntakeContext panels. `count` shows on the collapsed header so nothing feels
 * hidden; `defaultOpen` lets the parent open what's relevant to the stage.
 */
export function ContextPanel({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number | string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel">
      <button
        type="button"
        className="panel-header"
        data-open={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="panel-title">{title}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {count != null && count !== "" && (
            <span className="panel-count">{count}</span>
          )}
          <span className="panel-chevron">▼</span>
        </span>
      </button>
      {open && <div className="panel-body">{children}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 13, color: "var(--muted)" }}>{children}</span>;
}
