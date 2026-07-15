"use client";

import { useEffect, useRef, useState } from "react";

// The active *client* company — the rail operator this crew is currently doing
// maintenance for. Distinct from the user's own employer (their contracting
// firm), which stays fixed and lives in the TopNav profile menu. A contractor
// can service several rail companies and switches between them here.
//
// Frontend-only mock for now: the roster is hardcoded and the selection lives in
// local state. Wire this to real multi-org membership (GET the user's companies,
// POST an active-org selection, refetch scoped data) when the backend lands.
export type Company = {
  id: string;
  name: string;
  // Short descriptor shown under the name in the switcher list.
  hint: string;
};

const COMPANIES: Company[] = [
  { id: "telar", name: "TelarRail", hint: "Regional freight · 24 units" },
  { id: "northline", name: "Northline Transit", hint: "Commuter rail · 12 units" },
  { id: "cascade", name: "Cascade Freight Co.", hint: "Heavy haul · 31 units" },
];

export function CompanySwitcher() {
  // Default to TelarRail (the test company).
  const [activeId, setActiveId] = useState<string>(COMPANIES[0].id);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const active = COMPANIES.find((c) => c.id === activeId) ?? COMPANIES[0];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(ev: MouseEvent) {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(id: string) {
    setActiveId(id);
    setOpen(false);
  }

  return (
    <div className="dash-card dash-stat dash-stat--company" ref={rootRef}>
      <div className="dash-stat-toprow">
        <span className="dash-stat-label">Working with</span>
        <button
          type="button"
          className="dash-company-switch"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((v) => !v)}
        >
          Switch
          <span
            className={`dash-chevron dash-company-chevron${open ? " is-open" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>

      <div className="dash-company-text">
        <span className="dash-company-name">{active.name}</span>
        <span className="dash-company-hint">{active.hint}</span>
      </div>

      {open && (
        <div className="dash-company-menu" role="menu">
          <div className="fig-profile-dropdown-label">Companies you service</div>
          {COMPANIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitemradio"
              aria-checked={c.id === active.id}
              className="fig-profile-option"
              data-active={c.id === active.id}
              onClick={() => pick(c.id)}
            >
              <span className="fig-profile-option-main">
                <span className="fig-profile-option-dot" aria-hidden="true">
                  {c.id === active.id && <span className="dash-dot" />}
                </span>
                <span>{c.name}</span>
              </span>
              <span className="fig-profile-option-hint">{c.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
