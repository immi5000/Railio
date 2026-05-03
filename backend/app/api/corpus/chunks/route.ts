import type { NextRequest } from "next/server";
import { json, preflight } from "@/lib/cors";
import { getSql } from "@/lib/db";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const docClass = url.searchParams.get("doc_class");
  const q = url.searchParams.get("q");
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(
    Math.max(Number.parseInt(limitRaw ?? "500", 10) || 500, 1),
    2000,
  );

  const sql = getSql();
  const isClass = docClass === "manual" || docClass === "tribal_knowledge";
  const like = q && q.trim() ? `%${q.trim()}%` : null;

  let chunks: unknown[];
  if (isClass && like) {
    chunks = await sql<any[]>`
      SELECT id, doc_class, doc_id, doc_title, source_label, page, text
      FROM corpus_chunks
      WHERE doc_class = ${docClass}
        AND (text ILIKE ${like} OR doc_title ILIKE ${like} OR source_label ILIKE ${like})
      ORDER BY doc_class, doc_title, COALESCE(page, 0), id
      LIMIT ${limit}
    `;
  } else if (isClass) {
    chunks = await sql<any[]>`
      SELECT id, doc_class, doc_id, doc_title, source_label, page, text
      FROM corpus_chunks
      WHERE doc_class = ${docClass}
      ORDER BY doc_class, doc_title, COALESCE(page, 0), id
      LIMIT ${limit}
    `;
  } else if (like) {
    chunks = await sql<any[]>`
      SELECT id, doc_class, doc_id, doc_title, source_label, page, text
      FROM corpus_chunks
      WHERE text ILIKE ${like} OR doc_title ILIKE ${like} OR source_label ILIKE ${like}
      ORDER BY doc_class, doc_title, COALESCE(page, 0), id
      LIMIT ${limit}
    `;
  } else {
    chunks = await sql<any[]>`
      SELECT id, doc_class, doc_id, doc_title, source_label, page, text
      FROM corpus_chunks
      ORDER BY doc_class, doc_title, COALESCE(page, 0), id
      LIMIT ${limit}
    `;
  }

  return json({ chunks });
}
