/**
 * PartDetailModal's patch-building.
 *
 * The behavior worth pinning is what it *sends*: qty_on_hand and avg_cost are
 * server-derived once a part has locations, so sending them alongside a
 * locations edit would fight the server's normalization and let the total drift
 * from its breakdown. The backend guards its half (see
 * backend/tests/api/test_parts_locations.py); this is the client's half.
 */
import type { Part } from "@contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { patchPart, createPart } = vi.hoisted(() => ({
  patchPart: vi.fn(),
  createPart: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  patchPart,
  createPart,
}));

import { PartDetailModal } from "@/components/PartDetailModal";

const PART: Part = {
  id: 7966,
  part_number: "L-8160209",
  name: "INJECTOR",
  description: "fuel injector",
  compatible_units: [],
  bin_location: "A1",
  qty_on_hand: 10,
  supplier: "EMD",
  lead_time_days: 5,
  alternate_part_numbers: [],
  last_used_at: null,
  avg_cost: 100,
  on_hand_value: 1000,
  locations: [
    { location: "MAIN-A1", qty: 6, avg_cost: 100, value: 600 },
    { location: "YARD-B2", qty: 4, avg_cost: 100, value: 400 },
  ],
  department: null,
  subsidiary: null,
  inv_class: null,
};

function setup(part: Part | null = PART) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PartDetailModal part={part} onClose={onClose} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return { onClose, onSaved, user: userEvent.setup() };
}

const saveButton = () => screen.getByRole("button", { name: /^Save/ });

beforeEach(() => {
  patchPart.mockResolvedValue({ ...PART, name: "changed" });
  createPart.mockResolvedValue(PART);
});

describe("PartDetailModal", () => {
  it("loads the part into the form", () => {
    setup();
    expect(screen.getByDisplayValue("L-8160209")).toBeInTheDocument();
    expect(screen.getByDisplayValue("INJECTOR")).toBeInTheDocument();
  });

  it("sends only what changed", async () => {
    const { user } = setup();
    const name = screen.getByDisplayValue("INJECTOR");
    await user.clear(name);
    await user.type(name, "INJECTOR REV B");
    await user.click(saveButton());

    await waitFor(() => expect(patchPart).toHaveBeenCalled());
    const [id, patch] = patchPart.mock.calls[0];
    expect(id).toBe(PART.id);
    expect(patch).toEqual({ name: "INJECTOR REV B" });
  });

  it("closes without a request when nothing changed", async () => {
    const { user, onClose } = setup();
    await user.click(saveButton());
    expect(patchPart).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("never sends a client-computed qty for a part that has locations", async () => {
    const { user } = setup();
    const name = screen.getByDisplayValue("INJECTOR");
    await user.clear(name);
    await user.type(name, "x");
    await user.click(saveButton());

    await waitFor(() => expect(patchPart).toHaveBeenCalled());
    const [, patch] = patchPart.mock.calls[0];
    expect(patch).not.toHaveProperty("qty_on_hand");
    expect(patch).not.toHaveProperty("avg_cost");
  });

  it("does send qty for a part with no locations, where it is author-owned", async () => {
    const flat: Part = { ...PART, locations: [] };
    const { user } = setup(flat);
    const qty = screen.getByDisplayValue("10");
    await user.clear(qty);
    await user.type(qty, "12");
    await user.click(saveButton());

    await waitFor(() => expect(patchPart).toHaveBeenCalled());
    expect(patchPart.mock.calls[0][1]).toMatchObject({ qty_on_hand: 12 });
  });

  it("creates rather than patches when there's no part", async () => {
    const { user } = setup(null);
    await user.type(screen.getByLabelText("Part # *"), "NEW-1");
    await user.type(screen.getByLabelText("Name *"), "New widget");
    // The commit button says "Create part" in create mode, not "Save".
    await user.click(screen.getByRole("button", { name: "Create part" }));

    await waitFor(() => expect(createPart).toHaveBeenCalled());
    expect(patchPart).not.toHaveBeenCalled();
  });

  it("can't be saved without the two identifying fields", async () => {
    const { user } = setup();
    const number = screen.getByDisplayValue("L-8160209");
    await user.clear(number);
    expect(saveButton()).toBeDisabled();
  });

  describe("discarding", () => {
    it("closes on Escape when untouched", async () => {
      const { user, onClose } = setup();
      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalled();
    });

    it("asks before dropping edits", async () => {
      const { user, onClose } = setup();
      await user.type(screen.getByDisplayValue("INJECTOR"), "!");
      await user.keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();
      expect(document.body.textContent).toMatch(/discard/i);
    });
  });
});
