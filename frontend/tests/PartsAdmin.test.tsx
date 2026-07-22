/**
 * PartsAdmin's On hand cell.
 *
 * A part with 2+ locations has a derived total that must not be typed into — it
 * only moves when a per-location quantity changes (in the detail modal). The
 * spreadsheet renders it as a locked grey box. A part with 0 or 1 location keeps
 * an editable input, since editing the total there is unambiguous.
 */
import type { ListPartsResponse, Part } from "@contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listParts, listAssets, getPartsFilterOptions } = vi.hoisted(() => ({
  listParts: vi.fn(),
  listAssets: vi.fn(),
  getPartsFilterOptions: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listParts,
  listAssets,
  getPartsFilterOptions,
}));

import { PartsAdmin } from "@/components/PartsAdmin";

function part(over: Partial<Part>): Part {
  return {
    id: 1,
    part_number: "P-1",
    name: "PART",
    description: null,
    compatible_units: [],
    bin_location: null,
    qty_on_hand: 0,
    supplier: null,
    lead_time_days: null,
    alternate_part_numbers: [],
    last_used_at: null,
    avg_cost: null,
    on_hand_value: null,
    locations: [],
    department: null,
    subsidiary: null,
    inv_class: null,
    ...over,
  };
}

const MULTI = part({
  id: 10,
  part_number: "MULTI-1",
  qty_on_hand: 10,
  avg_cost: 5,
  on_hand_value: 50,
  locations: [
    { location: "A", qty: 6, avg_cost: 5, value: 30 },
    { location: "B", qty: 4, avg_cost: 5, value: 20 },
  ],
});

const SINGLE = part({
  id: 11,
  part_number: "SINGLE-1",
  qty_on_hand: 7,
  avg_cost: 5,
  on_hand_value: 35,
  locations: [{ location: "A", qty: 7, avg_cost: 5, value: 35 }],
});

const NONE = part({ id: 12, part_number: "NONE-1", qty_on_hand: 3 });

function setup(parts: Part[]) {
  const resp: ListPartsResponse = { parts, total: parts.length };
  listParts.mockResolvedValue(resp);
  listAssets.mockResolvedValue([]);
  getPartsFilterOptions.mockResolvedValue({
    locations: [],
    suppliers: [],
    departments: [],
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <PartsAdmin />
    </QueryClientProvider>,
  );
}

describe("PartsAdmin On hand cell", () => {
  beforeEach(() => vi.clearAllMocks());

  it("locks On hand for a part with more than one location", async () => {
    setup([MULTI]);
    await screen.findByText("MULTI-1");

    const cell = document
      .querySelector("td[data-label='On hand']") as HTMLElement;
    // Locked: shows the derived total, has no input, and reads as not-allowed.
    expect(within(cell).queryByRole("spinbutton")).toBeNull();
    expect(cell.textContent).toContain("10");
    const box = cell.querySelector("div[title]") as HTMLElement;
    expect(box.getAttribute("title")).toMatch(/location quantities/i);
    expect(box.style.cursor).toBe("not-allowed");
  });

  it("keeps On hand editable for a single-location part", async () => {
    setup([SINGLE]);
    await screen.findByText("SINGLE-1");
    const cell = document.querySelector("td[data-label='On hand']") as HTMLElement;
    const input = within(cell).getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("7");
  });

  it("keeps On hand editable for a part with no locations", async () => {
    setup([NONE]);
    await screen.findByText("NONE-1");
    const cell = document.querySelector("td[data-label='On hand']") as HTMLElement;
    const input = within(cell).getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("3");
  });
});
