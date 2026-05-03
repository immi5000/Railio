import type { NextRequest } from "next/server";
import { json, jsonError, preflight } from "@/lib/cors";
import { getSql } from "@/lib/db";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sql = getSql();
  const rows = await sql<any[]>`
    SELECT id, doc_class, doc_id, doc_title, source_label, page, text
    FROM corpus_chunks WHERE id = ${Number(id)}
  `;
  if (!rows[0]) return jsonError("not found", 404);
  return json(rows[0]);
}
