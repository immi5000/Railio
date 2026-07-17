"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { PartLocation } from "@/lib/contract";

// When a part is stocked in 2+ locations and the total on-hand qty is edited
// directly, we can't know which shelf the change came from — so ask. Applying
// the delta to one location keeps qty_on_hand = sum(locations). A negative
// delta can't drive a location below zero, so those options are disabled.
export function QtyAllocationPrompt({
  delta,
  locations,
  onPick,
  onCancel,
}: {
  delta: number;
  locations: PartLocation[];
  onPick: (index: number) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const label = delta > 0 ? `+${delta}` : String(delta);

  return createPortal(
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal modal-sm"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="sect-eyebrow">Allocate stock</span>
        <h2 className="h2" style={{ marginTop: 10, fontSize: 18 }}>
          Apply {label} to which location?
        </h2>
        <div style={{ display: "grid", gap: 8, marginTop: 18 }}>
          {locations.map((loc, i) => {
            const disabled = delta < 0 && loc.qty + delta < 0;
            return (
              <button
                key={i}
                type="button"
                className="btn"
                disabled={disabled}
                style={{ justifyContent: "space-between", width: "100%" }}
                onClick={() => onPick(i)}
              >
                <span>{loc.location || "(unnamed)"}</span>
                <span
                  className="micro"
                  style={{ color: "var(--dash-muted)", fontWeight: 400 }}
                >
                  {disabled ? `only ${loc.qty} on hand` : `${loc.qty} on hand`}
                </span>
              </button>
            );
          })}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginTop: 20,
          }}
        >
          <button type="button" className="btn btn-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
