"use client";

import { useEffect, useRef, useState } from "react";

// The active *client* company — the rail operator this crew is currently doing
// maintenance for. Distinct from the user's own employer (their contracting
// firm), which stays fixed and lives in the TopNav profile menu. A contractor
// can service several rail companies and switches between them here.
//
// The active company is the signed-in user's real org (name + a live hint the
// dashboard computes from its own assets/tickets feeds). The other rows are
// still a frontend-only mock: real multi-org membership (GET the user's
// companies, POST an active-org selection, refetch scoped data) isn't wired yet.
export type Company = {
  id: string;
  name: string;
  // Short descriptor shown under the name in the switcher list.
  hint: string;
};

// Mock alternatives the switcher lists beneath the user's real org, so the
// contractor-switches-clients affordance still reads. Replace with real
// membership when the backend lands.
const OTHER_COMPANIES: Company[] = [
  { id: "northline", name: "Northline Transit", hint: "Commuter rail · 12 units" },
  { id: "cascade", name: "Cascade Freight Co.", hint: "Heavy haul · 31 units" },
];

const ACTIVE_ID = "self";

export type CompanySwitcherProps = {
  // The signed-in user's org name (null until /api/me resolves).
  orgName?: string | null;
  // Live descriptor built from real fleet/ticket data, e.g. "24 units · 3 open".
  hint?: string;
};

export function CompanySwitcher({ orgName, hint }: CompanySwitcherProps) {
  // The real org is the default; the mock rows are switchable stand-ins.
  const self: Company = {
    id: ACTIVE_ID,
    name: orgName || "Your organization",
    hint: hint || "—",
  };
  const companies = [self, ...OTHER_COMPANIES];

  const [activeId, setActiveId] = useState<string>(ACTIVE_ID);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const active = companies.find((c) => c.id === activeId) ?? self;

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
          {companies.map((c) => (
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
