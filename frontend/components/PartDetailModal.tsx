"use client";

import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPart, patchPart } from "@/lib/api";
import type { CreatePartBody, Part, PartLocation } from "@/lib/contract";
import { deriveTotals, fmtMoney } from "@/lib/parts";

type Draft = {
  part_number: string;
  name: string;
  description: string;
  compatible_units: string;
  bin_location: string;
  qty_on_hand: string;
  avg_cost: string;
  supplier: string;
  department: string;
  subsidiary: string;
  inv_class: string;
  lead_time_days: string;
  alternate_part_numbers: string;
  locations: PartLocation[];
};

const BLANK: Draft = {
  part_number: "",
  name: "",
  description: "",
  compatible_units: "",
  bin_location: "",
  qty_on_hand: "0",
  avg_cost: "",
  supplier: "",
  department: "",
  subsidiary: "",
  inv_class: "",
  lead_time_days: "",
  alternate_part_numbers: "",
  locations: [],
};

function toDraft(p: Part | null): Draft {
  if (!p) return { ...BLANK };
  return {
    part_number: p.part_number,
    name: p.name,
    description: p.description || "",
    compatible_units: (p.compatible_units || []).join(", "),
    bin_location: p.bin_location || "",
    qty_on_hand: String(p.qty_on_hand),
    avg_cost: p.avg_cost != null ? String(p.avg_cost) : "",
    supplier: p.supplier || "",
    department: p.department || "",
    subsidiary: p.subsidiary || "",
    inv_class: p.inv_class || "",
    lead_time_days: p.lead_time_days != null ? String(p.lead_time_days) : "",
    alternate_part_numbers: (p.alternate_part_numbers || []).join(", "),
    locations: (p.locations || []).map((l) => ({ ...l })),
  };
}

function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function cleanLocations(locs: PartLocation[]): PartLocation[] {
  return locs
    .filter((l) => l.location.trim())
    .map((l) => ({
      location: l.location.trim(),
      qty: Number(l.qty) || 0,
      avg_cost:
        l.avg_cost == null || (l.avg_cost as unknown as string) === ""
          ? null
          : Number(l.avg_cost),
      value: null,
    }));
}

export function PartDetailModal({
  part,
  focusLocations,
  onClose,
  onSaved,
}: {
  part: Part | null;
  focusLocations?: boolean;
  onClose: () => void;
  onSaved: (updated: Part) => void;
}) {
  const creating = part == null;
  const initial = useMemo(() => toDraft(part), [part]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const locSectionRef = useRef<HTMLDivElement>(null);

  const mut = useMutation({
    mutationFn: (d: Draft) =>
      creating ? createPart(buildCreateBody(d)) : patchPart(part!.id, buildPatch(d)),
    onSuccess: (updated) => onSaved(updated),
  });

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  function requestClose() {
    if (mut.isPending) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || mut.isPending) return;
      if (confirmDiscard) setConfirmDiscard(false);
      else if (dirty) setConfirmDiscard(true);
      else onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, mut.isPending, dirty, confirmDiscard]);

  useEffect(() => {
    if (focusLocations) locSectionRef.current?.scrollIntoView({ block: "center" });
  }, [focusLocations]);

  const hasLocations = draft.locations.length > 0;
  const totals = deriveTotals(
    draft.locations,
    Number(draft.qty_on_hand) || 0,
    draft.avg_cost === "" ? null : Number(draft.avg_cost),
  );

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setLoc(i: number, patch: Partial<PartLocation>) {
    setDraft((d) => ({
      ...d,
      locations: d.locations.map((l, j) => (j === i ? { ...l, ...patch } : l)),
    }));
  }

  function addLoc() {
    setDraft((d) => {
      const first = d.locations.length === 0;
      const cost = d.avg_cost === "" ? null : Number(d.avg_cost);
      // Naming where a part's existing stock lives shouldn't zero its total, so
      // the first location inherits the current qty. Later rows start empty but
      // still inherit the cost — a null-cost row would drag the weighted avg down.
      return {
        ...d,
        locations: [
          ...d.locations,
          {
            location: "",
            qty: first ? Number(d.qty_on_hand) || 0 : 0,
            avg_cost: first ? cost : totals.avgCost,
            value: null,
          },
        ],
      };
    });
  }

  function removeLoc(i: number) {
    setDraft((d) => ({ ...d, locations: d.locations.filter((_, j) => j !== i) }));
  }

  function buildCreateBody(d: Draft): CreatePartBody {
    const locs = cleanLocations(d.locations);
    return {
      part_number: d.part_number.trim(),
      name: d.name.trim(),
      description: d.description.trim() || null,
      compatible_units: splitList(d.compatible_units),
      bin_location: d.bin_location.trim() || null,
      qty_on_hand: Number(d.qty_on_hand) || 0,
      avg_cost: d.avg_cost === "" ? null : Number(d.avg_cost),
      supplier: d.supplier.trim() || null,
      lead_time_days: d.lead_time_days === "" ? null : Number(d.lead_time_days),
      alternate_part_numbers: splitList(d.alternate_part_numbers),
      locations: locs,
      department: d.department.trim() || null,
      subsidiary: d.subsidiary.trim() || null,
      inv_class: d.inv_class.trim() || null,
    };
  }

  function buildPatch(d: Draft): Partial<Part> {
    const p = part!;
    const patch: Partial<Part> = {};
    if (d.part_number.trim() !== p.part_number)
      patch.part_number = d.part_number.trim();
    if (d.name.trim() !== p.name) patch.name = d.name.trim();
    if ((d.description.trim() || null) !== p.description)
      patch.description = d.description.trim() || null;
    const compat = splitList(d.compatible_units);
    if (JSON.stringify(compat) !== JSON.stringify(p.compatible_units || []))
      patch.compatible_units = compat;
    if ((d.bin_location.trim() || null) !== p.bin_location)
      patch.bin_location = d.bin_location.trim() || null;
    if ((d.supplier.trim() || null) !== p.supplier)
      patch.supplier = d.supplier.trim() || null;
    if ((d.department.trim() || null) !== p.department)
      patch.department = d.department.trim() || null;
    if ((d.subsidiary.trim() || null) !== p.subsidiary)
      patch.subsidiary = d.subsidiary.trim() || null;
    if ((d.inv_class.trim() || null) !== p.inv_class)
      patch.inv_class = d.inv_class.trim() || null;
    const lead = d.lead_time_days === "" ? null : Number(d.lead_time_days);
    if (lead !== p.lead_time_days) patch.lead_time_days = lead;
    const alts = splitList(d.alternate_part_numbers);
    if (JSON.stringify(alts) !== JSON.stringify(p.alternate_part_numbers || []))
      patch.alternate_part_numbers = alts;

    const locs = cleanLocations(d.locations);
    const prevLocs = cleanLocations(p.locations || []);
    if (JSON.stringify(locs) !== JSON.stringify(prevLocs)) patch.locations = locs;

    // qty/avg are server-derived once a part has locations — only send them
    // when they're actually author-owned.
    if (locs.length === 0) {
      if (Number(d.qty_on_hand) !== p.qty_on_hand)
        patch.qty_on_hand = Number(d.qty_on_hand) || 0;
      const avg = d.avg_cost === "" ? null : Number(d.avg_cost);
      if (avg !== p.avg_cost) patch.avg_cost = avg;
    }
    return patch;
  }

  function save() {
    if (!creating && Object.keys(buildPatch(draft)).length === 0) {
      onClose();
      return;
    }
    mut.mutate(draft);
  }

  const canSave = !!draft.part_number.trim() && !!draft.name.trim();

  return (
    <div className="modal-backdrop" onClick={requestClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close"
          aria-label="Close"
          onClick={requestClose}
        >
          ✕
        </button>

        <div className="modal-body">
          <div className="modal-title-row">
            <span className="sect-eyebrow">
              {creating ? "New part" : `Part · ${part!.part_number}`}
            </span>
            <h2 className="h2" style={{ marginTop: 10, fontSize: 20 }}>
              {draft.name || (creating ? "Untitled part" : "Part")}
            </h2>
          </div>

          <div className="modal-stats">
            <Stat label="On hand" value={String(totals.qty)} />
            <Stat label="Avg cost" value={fmtMoney(totals.avgCost) || "—"} />
            <Stat label="Value" value={fmtMoney(totals.value) || "—"} />
          </div>

          <div className="modal-section" style={{ marginTop: 24 }}>
            <span className="sect-eyebrow">Identification</span>
            <div className="modal-grid">
              <ModalField label="Part # *">
                <input
                  className="input"
                  value={draft.part_number}
                  onChange={(e) => set("part_number", e.target.value)}
                />
              </ModalField>
              <ModalField label="Name *">
                <input
                  className="input"
                  value={draft.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </ModalField>
              <ModalField label="Description" span>
                <input
                  className="input"
                  value={draft.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </ModalField>
            </div>
          </div>

          <div className="modal-section" ref={locSectionRef}>
            <span className="sect-eyebrow">Stock</span>
            <div className="modal-grid">
              <ModalField label="Bin">
                <input
                  className="input"
                  value={draft.bin_location}
                  onChange={(e) => set("bin_location", e.target.value)}
                />
              </ModalField>
              {!hasLocations && (
                <>
                  <ModalField label="On hand">
                    <input
                      className="input"
                      type="number"
                      value={draft.qty_on_hand}
                      onChange={(e) => set("qty_on_hand", e.target.value)}
                    />
                  </ModalField>
                  <ModalField label="Avg cost">
                    <input
                      className="input"
                      type="number"
                      value={draft.avg_cost}
                      onChange={(e) => set("avg_cost", e.target.value)}
                    />
                  </ModalField>
                </>
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              <span
                className="micro"
                style={{ color: "var(--dash-muted)", display: "block" }}
              >
                {hasLocations
                  ? "On hand and avg cost are totalled from the locations below."
                  : "Not split across locations. Add one to track per-shelf stock."}
              </span>
              {hasLocations && (
                <div
                  className="modal-loc-row"
                  style={{ color: "var(--dash-faint)", marginTop: 10, marginBottom: 4 }}
                >
                  <span className="micro">Location</span>
                  <span className="micro">Qty</span>
                  <span className="micro">Avg cost</span>
                  <span />
                </div>
              )}
              {draft.locations.map((loc, i) => (
                <div className="modal-loc-row" key={i}>
                  <input
                    className="input"
                    placeholder="Warehouse / shelf"
                    value={loc.location}
                    onChange={(e) => setLoc(i, { location: e.target.value })}
                  />
                  <input
                    className="input"
                    type="number"
                    value={String(loc.qty)}
                    onChange={(e) => setLoc(i, { qty: Number(e.target.value) || 0 })}
                  />
                  <input
                    className="input"
                    type="number"
                    value={loc.avg_cost == null ? "" : String(loc.avg_cost)}
                    onChange={(e) =>
                      setLoc(i, {
                        avg_cost: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="modal-loc-del"
                    aria-label={`Remove location ${loc.location || i + 1}`}
                    title="Remove location"
                    onClick={() => removeLoc(i)}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-sm"
                style={{ marginTop: 6 }}
                onClick={addLoc}
              >
                + Add location
              </button>
            </div>
          </div>

          <div className="modal-section">
            <span className="sect-eyebrow">Sourcing</span>
            <div className="modal-grid">
              <ModalField label="Supplier">
                <input
                  className="input"
                  value={draft.supplier}
                  onChange={(e) => set("supplier", e.target.value)}
                />
              </ModalField>
              <ModalField label="Lead time (days)">
                <input
                  className="input"
                  type="number"
                  value={draft.lead_time_days}
                  onChange={(e) => set("lead_time_days", e.target.value)}
                />
              </ModalField>
              <ModalField label="Department">
                <input
                  className="input"
                  value={draft.department}
                  onChange={(e) => set("department", e.target.value)}
                />
              </ModalField>
              <ModalField label="Subsidiary">
                <input
                  className="input"
                  value={draft.subsidiary}
                  onChange={(e) => set("subsidiary", e.target.value)}
                />
              </ModalField>
              <ModalField label="Inv class">
                <input
                  className="input"
                  value={draft.inv_class}
                  onChange={(e) => set("inv_class", e.target.value)}
                />
              </ModalField>
            </div>
          </div>

          <div className="modal-section">
            <span className="sect-eyebrow">Compatibility</span>
            <div className="modal-grid">
              <ModalField label="Compatible units (comma-sep)">
                <input
                  className="input"
                  value={draft.compatible_units}
                  onChange={(e) => set("compatible_units", e.target.value)}
                />
              </ModalField>
              <ModalField label="Alternates (comma-sep)">
                <input
                  className="input"
                  value={draft.alternate_part_numbers}
                  onChange={(e) => set("alternate_part_numbers", e.target.value)}
                />
              </ModalField>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          {mut.error && (
            <span
              className="micro"
              style={{ color: "var(--dash-danger)", marginRight: "auto" }}
            >
              {(mut.error as Error).message}
            </span>
          )}
          <button
            type="button"
            className="btn"
            disabled={mut.isPending}
            onClick={requestClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-super"
            disabled={mut.isPending || !canSave}
            onClick={save}
          >
            {mut.isPending ? "Saving…" : creating ? "Create part" : "Save"}
          </button>
        </div>
      </div>

      {confirmDiscard && (
        <div
          className="modal-backdrop modal-backdrop--top"
          onClick={(e) => {
            e.stopPropagation();
            setConfirmDiscard(false);
          }}
        >
          <div
            className="modal modal-sm"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-body">
              <span className="sect-eyebrow">Unsaved changes</span>
              <h2 className="h2" style={{ marginTop: 10, fontSize: 18 }}>
                Discard changes?
              </h2>
              <p className="micro" style={{ color: "var(--dash-muted)", marginTop: 10 }}>
                {creating
                  ? "This part hasn't been created yet."
                  : "Your edits to this part won't be saved."}
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setConfirmDiscard(false)}
              >
                Keep editing
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  color: "var(--dash-danger)",
                  borderColor: "var(--dash-danger)",
                }}
                onClick={onClose}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="modal-stat">
      <div className="modal-stat-label">{label}</div>
      <div className="modal-stat-value">{value}</div>
    </div>
  );
}

function ModalField({
  label,
  span,
  children,
}: {
  label: string;
  span?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={span ? "modal-span" : undefined} style={{ display: "grid", gap: 4 }}>
      <span className="micro" style={{ color: "var(--dash-muted)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}
