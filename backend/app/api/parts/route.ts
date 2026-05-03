import type { NextRequest } from "next/server";
import { json, preflight } from "@/lib/cors";
import { getSql } from "@/lib/db";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(req: NextRequest) {
  const unit = req.nextUrl.searchParams.get("unit_model");
  const q = req.nextUrl.searchParams.get("q");
  const sql = getSql();
  const like = q ? `%${q}%` : null;

  let rows: any[];
  if (unit && like) {
    rows = await sql<any[]>`
      SELECT * FROM parts p
      WHERE p.compatible_units ? ${unit}
        AND (p.name ILIKE ${like} OR p.description ILIKE ${like} OR p.part_number ILIKE ${like})
      ORDER BY p.name ASC
    `;
  } else if (unit) {
    rows = await sql<any[]>`
      SELECT * FROM parts p WHERE p.compatible_units ? ${unit} ORDER BY p.name ASC
    `;
  } else if (like) {
    rows = await sql<any[]>`
      SELECT * FROM parts p
      WHERE p.name ILIKE ${like} OR p.description ILIKE ${like} OR p.part_number ILIKE ${like}
      ORDER BY p.name ASC
    `;
  } else {
    rows = await sql<any[]>`SELECT * FROM parts p ORDER BY p.name ASC`;
  }
  return json(rows.map(rowToPart));
}

function rowToPart(r: any) {
  return {
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
  };
}
