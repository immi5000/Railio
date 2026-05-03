import { getSql } from "../db";

type Input = { unit_model: string; query: string };

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "with",
  "is", "are", "be", "this", "that", "these", "those", "it", "its",
  "part", "parts", "component", "components", "piece", "pieces",
  "need", "needed", "looking", "find",
]);

function tokenize(q: string): string[] {
  return Array.from(
    new Set(
      q
        .toLowerCase()
        .split(/[^a-z0-9-]+/)
        .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    )
  );
}

export async function lookupParts(inp: Input) {
  const sql = getSql();
  const tokens = tokenize(inp.query);
  const terms = tokens.length > 0 ? tokens : [inp.query.trim().toLowerCase()].filter(Boolean);
  if (terms.length === 0) return { matches: [] };

  // Postgres: case-insensitive LIKE via ILIKE; jsonb membership via `?` operator (escaped here as a function call).
  // Hit count = number of tokens that match in name OR description OR part_number.
  const likeArgs = terms.map((t) => `%${t}%`);

  const rows = await sql<any[]>`
    SELECT p.*,
      (
        SELECT COUNT(*) FROM unnest(${sql.array(likeArgs)}::text[]) AS term
        WHERE p.name ILIKE term OR p.description ILIKE term OR p.part_number ILIKE term
      ) AS hit_count
    FROM parts p
    WHERE p.compatible_units ? ${inp.unit_model}
      AND EXISTS (
        SELECT 1 FROM unnest(${sql.array(likeArgs)}::text[]) AS term
        WHERE p.name ILIKE term OR p.description ILIKE term OR p.part_number ILIKE term
      )
    ORDER BY hit_count DESC, p.qty_on_hand DESC, p.name ASC
    LIMIT 10
  `;

  return {
    matches: rows.map((r: any) => ({
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
    })),
  };
}
