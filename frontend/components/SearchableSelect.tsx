"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Type-ahead combobox: free-text filters the option list (best-match — prefix
// matches rank before substring matches) but the committed value is always one
// of `options` or the empty string (no filter). Used for the parts location /
// supplier / department / unit filters.
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  // While closed, the field shows the committed value; typing opens the menu
  // and drives filtering off the draft text.
  const display = open ? text : value;

  const matches = useMemo(() => {
    const t = text.trim().toLowerCase();
    if (!t) return options;
    const starts: string[] = [];
    const includes: string[] = [];
    for (const o of options) {
      const lo = o.toLowerCase();
      if (lo.startsWith(t)) starts.push(o);
      else if (lo.includes(t)) includes.push(o);
    }
    return [...starts, ...includes];
  }, [text, options]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        close();
      }
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  });

  function close() {
    setOpen(false);
    setText("");
    setActive(0);
  }

  function pick(v: string) {
    onChange(v);
    close();
  }

  return (
    <div className="combo" ref={wrapRef} style={{ width: width ?? 180 }}>
      <input
        className="input"
        style={{ paddingRight: value && !open ? 30 : undefined }}
        value={display}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setText("");
          setActive(0);
        }}
        onChange={(e) => {
          if (!open) setOpen(true);
          setText(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(matches.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && matches[active] != null) pick(matches[active]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      />
      {value && !open && (
        <button
          type="button"
          className="combo-clear"
          aria-label="Clear filter"
          onClick={() => onChange("")}
        >
          ×
        </button>
      )}
      {open && (
        <div className="combo-menu">
          {matches.length === 0 && <div className="combo-empty">No matches</div>}
          {matches.map((o, i) => (
            <div
              key={o}
              className={
                "combo-opt" +
                (i === active ? " is-active" : "") +
                (o === value ? " is-selected" : "")
              }
              onMouseEnter={() => setActive(i)}
              // pointerdown (not click) so the option commits before the input's
              // blur/outside-pointerdown handler can close the menu first.
              onPointerDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
            >
              {o}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
