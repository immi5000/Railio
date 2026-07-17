import type { PartLocation } from "@contract";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { QtyAllocationPrompt } from "@/components/QtyAllocationPrompt";

const LOCATIONS: PartLocation[] = [
  { location: "MAIN-A1", qty: 5, avg_cost: 10, value: 50 },
  { location: "YARD-B2", qty: 2, avg_cost: 10, value: 20 },
];

function setup(delta: number, locations = LOCATIONS) {
  const onPick = vi.fn();
  const onCancel = vi.fn();
  render(
    <QtyAllocationPrompt
      delta={delta}
      locations={locations}
      onPick={onPick}
      onCancel={onCancel}
    />,
  );
  return { onPick, onCancel, user: userEvent.setup() };
}

describe("QtyAllocationPrompt", () => {
  it("signs the delta so it's clear whether stock is going up or down", () => {
    setup(3);
    expect(screen.getByRole("heading")).toHaveTextContent("Apply +3 to which location?");
  });

  it("shows a negative delta as-is", () => {
    setup(-2);
    expect(screen.getByRole("heading")).toHaveTextContent("Apply -2 to which location?");
  });

  it("reports which location was picked, by index", async () => {
    const { onPick, user } = setup(3);
    await user.click(screen.getByRole("button", { name: /YARD-B2/ }));
    expect(onPick).toHaveBeenCalledWith(1);
  });

  // The invariant the whole component exists to protect: qty_on_hand is the sum
  // of its locations, so no single location may be driven negative.
  it("disables a location that can't absorb the removal", () => {
    setup(-4);
    expect(screen.getByRole("button", { name: /MAIN-A1/ })).toBeEnabled();

    const yard = screen.getByRole("button", { name: /YARD-B2/ });
    expect(yard).toBeDisabled();
    expect(yard).toHaveTextContent("only 2 on hand");
  });

  it("allows a removal that exactly empties a location", () => {
    setup(-2);
    expect(screen.getByRole("button", { name: /YARD-B2/ })).toBeEnabled();
  });

  it("never disables anything when stock is being added", () => {
    setup(99);
    for (const loc of LOCATIONS) {
      expect(screen.getByRole("button", { name: new RegExp(loc.location) })).toBeEnabled();
    }
  });

  it("labels an unnamed location rather than rendering a blank button", () => {
    setup(1, [{ location: "", qty: 1, avg_cost: null, value: null }]);
    expect(screen.getByRole("button", { name: /\(unnamed\)/ })).toBeInTheDocument();
  });

  describe("dismissal", () => {
    it("cancels on Escape", async () => {
      const { onCancel, user } = setup(1);
      await user.keyboard("{Escape}");
      expect(onCancel).toHaveBeenCalled();
    });

    it("cancels on a backdrop click", async () => {
      const { onCancel, user } = setup(1);
      await user.click(document.querySelector(".modal-backdrop")!);
      expect(onCancel).toHaveBeenCalled();
    });

    it("stays open when the dialog itself is clicked", async () => {
      const { onCancel, user } = setup(1);
      await user.click(screen.getByRole("dialog"));
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("cancels on the Cancel button", async () => {
      const { onCancel, user } = setup(1);
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onCancel).toHaveBeenCalled();
    });
  });
});
