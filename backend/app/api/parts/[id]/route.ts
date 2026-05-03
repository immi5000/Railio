import type { NextRequest } from "next/server";
import { json, jsonError, preflight } from "@/lib/cors";
import { getSql } from "@/lib/db";

const COLS = new Set([
  "part_number",
  "name",
  "description",
  "compatible_units",
  "bin_location",
  "qty_on_hand",
  "supplier",
  "lead_time_days",
  "alternate_part_numbers",
  "last_used_at",
]);

const JSONB_COLS = new Set(["compatible_units", "alternate_part_numbers"]);

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as Record<string, unknown>;

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!COLS.has(k)) continue;
    updates[k] = v;
  }
  if (!Object.keys(updates).length) return jsonError("no valid fields", 400);

  const sql = getSql();
  const partId = Number(id);

  // Build a single UPDATE using sql() helper for dynamic column assignments.
  // postgres-js doesn't expose a builder for SET, so apply each column separately.
  for (const [k, v] of Object.entries(updates)) {
    if (JSONB_COLS.has(k)) {
      await sql`UPDATE parts SET ${sql(k)} = ${sql.json(v as any)} WHERE id = ${partId}`;
    } else {
      await sql`UPDATE parts SET ${sql(k)} = ${v as any} WHERE id = ${partId}`;
    }
  }

  const rows = await sql<any[]>`SELECT * FROM parts WHERE id = ${partId}`;
  const r = rows[0];
  if (!r) return jsonError("not found", 404);
  return json({
    id: r.id,
    part_number: r.part_number,
    name: r.name,
    description: r.description,
    compatible_units: r.compatible_units ?? [],
    bin_location: r.bin_location,
    qty_on_hand: r.qty_on_hand,
    supplier: r.supplier,
    lead_time_days: r.lead_time_days,
    alternate_part_numbers: r.alternate_part_numbers ?? [],
    last_used_at: r.last_used_at,
  });
}
