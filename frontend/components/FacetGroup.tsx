"use client";

// A generic pill multi-select over a list of string options. Extracted from
// FleetAdmin so the copilot scope panel can reuse the exact same affordance.
export function FacetGroup({
  title,
  options,
  selected,
  onToggle,
  labels,
}: {
  title?: string;
  options: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  labels?: Record<string, string>;
}) {
  if (options.length === 0) return null;
  return (
    <div>
      {title && (
        <div
          className="micro"
          style={{
            color: "var(--dash-faint)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            marginBottom: 6,
            fontFamily: '"IBM Plex Mono", monospace',
          }}
        >
          {title}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {options.map((opt) => {
          const on = selected.has(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              className="micro"
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "3px 10px",
                borderRadius: 999,
                cursor: "pointer",
                border: `1px solid ${on ? "var(--dash-link)" : "var(--dash-border)"}`,
                background: on ? "rgba(38, 131, 235, 0.08)" : "#fff",
                color: on ? "var(--dash-link)" : "var(--dash-muted)",
                fontFamily: '"IBM Plex Mono", monospace',
              }}
            >
              {labels?.[opt] ?? opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
