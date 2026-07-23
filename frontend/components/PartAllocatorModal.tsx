"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Part, PartAllocation } from "@/lib/contract";
import { fmtLocations } from "@/lib/parts";
import type { TicketPartsController } from "@/lib/useTicketParts";

// Per-part popup opened from the chat's inline "+" (and the sidebar). For a part
// stocked across bins it shows a +/- stepper per location so the tech picks how
// many to draw from each; a single-location/no-location part shows one stepper.
// Every change flows through the shared optimistic controller, so the chat and
// sidebar update instantly and the choice reaches Complete & wrap-up.
export function PartAllocatorModal({
  part,
  controller,
  onClose,
}: {
  part: Part;
  controller: TicketPartsController;
  onClose: () => void;
}) {
  const locations = part.locations ?? [];
  const hasLocs = locations.length > 0;
  const added = controller.addedPartIds.has(part.id);

  // Seed from what's already recorded on the ticket for this part.
  const [byLoc, setByLoc] = useState<Record<string, number>>(() => {
    const existing = controller.allocationsByPartId.get(part.id) ?? [];
    const seed: Record<string, number> = {};
    for (const a of existing) seed[a.location] = a.qty;
    return seed;
  });
  const [flatQty, setFlatQty] = useState<number>(
    () => controller.qtyByPartId.get(part.id) ?? 0,
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const total = hasLocs
    ? Object.values(byLoc).reduce((s, n) => s + n, 0)
    : flatQty;

  function commitLocs(next: Record<string, number>) {
    setByLoc(next);
    const allocations: PartAllocation[] = Object.entries(next)
      .filter(([, q]) => q > 0)
      .map(([location, qty]) => ({ location, qty }));
    controller.setAllocations(part.id, allocations);
  }

  function setLocQty(location: string, qty: number, cap: number) {
    const clamped = Math.max(0, Math.min(qty, cap));
    commitLocs({ ...byLoc, [location]: clamped });
  }

  function setFlat(qty: number) {
    const clamped = Math.max(0, qty);
    setFlatQty(clamped);
    controller.setQty(part.id, clamped);
  }

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-sm"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>

        <div style={{ padding: "16px 44px 0 20px" }}>
          <span className="sect-eyebrow">Add to ticket</span>
          <h2 className="h2" style={{ marginTop: 6, fontSize: 18 }}>
            {part.name}
          </h2>
          <div className="micro" style={{ color: "var(--dash-muted)", marginTop: 2 }}>
            {part.part_number} · {part.qty_on_hand} on hand
            {hasLocs ? ` · ${fmtLocations(locations)}` : ""}
          </div>
        </div>

        <div className="modal-body" style={{ display: "grid", gap: 8 }}>
          {hasLocs ? (
            locations.map((loc) => {
              const q = byLoc[loc.location] ?? 0;
              const cap = Math.floor(loc.qty);
              return (
                <div
                  key={loc.location}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 10px",
                    border: "1px solid var(--dash-border)",
                    borderRadius: 12,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{loc.location}</div>
                    <div className="micro" style={{ color: "var(--dash-muted)" }}>
                      {cap} available
                    </div>
                  </div>
                  <QtyStepper
                    qty={q}
                    decDisabled={q <= 0}
                    incDisabled={q >= cap}
                    onDec={() => setLocQty(loc.location, q - 1, cap)}
                    onInc={() => setLocQty(loc.location, q + 1, cap)}
                  />
                </div>
              );
            })
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 10px",
                border: "1px solid var(--dash-border)",
                borderRadius: 12,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>
                  {part.bin_location || "Quantity"}
                </div>
                <div className="micro" style={{ color: "var(--dash-muted)" }}>
                  {part.qty_on_hand} on hand
                </div>
              </div>
              <QtyStepper
                qty={flatQty}
                decDisabled={flatQty <= 0}
                onDec={() => setFlat(flatQty - 1)}
                onInc={() => setFlat(flatQty + 1)}
              />
            </div>
          )}
        </div>

        <div
          className="modal-footer"
          style={{ justifyContent: "space-between", alignItems: "center" }}
        >
          <span style={{ fontSize: 13, fontWeight: 700 }}>Total: {total}</span>
          <div style={{ display: "flex", gap: 8 }}>
            {added && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  controller.remove(part.id);
                  onClose();
                }}
              >
                Remove
              </button>
            )}
            <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Small −/+ quantity control shared by the allocator popup and inline chips.
export function QtyStepper({
  qty,
  onDec,
  onInc,
  decDisabled,
  incDisabled,
}: {
  qty: number;
  onDec: () => void;
  onInc: () => void;
  decDisabled?: boolean;
  incDisabled?: boolean;
}) {
  const btn: React.CSSProperties = {
    width: 26,
    height: 26,
    borderRadius: 8,
    border: "1px solid var(--dash-border)",
    background: "#fff",
    cursor: "pointer",
    fontSize: 15,
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
      <button
        type="button"
        aria-label="Decrease"
        style={{ ...btn, opacity: decDisabled ? 0.4 : 1 }}
        disabled={decDisabled}
        onClick={onDec}
      >
        −
      </button>
      <span style={{ minWidth: 18, textAlign: "center", fontSize: 13, fontWeight: 700 }}>
        {qty}
      </span>
      <button
        type="button"
        aria-label="Increase"
        style={{ ...btn, opacity: incDisabled ? 0.4 : 1 }}
        disabled={incDisabled}
        onClick={onInc}
      >
        +
      </button>
    </div>
  );
}
