import { getSql } from "../db";
import { embed } from "../embeddings";

type Input = {
  query: string;
  k?: number;
  doc_class_filter?: "manual" | "tribal_knowledge" | "any";
};

export async function searchCorpus(inp: Input) {
  const k = Math.max(1, Math.min(20, inp.k ?? 6));
  const filter = inp.doc_class_filter ?? "any";
  const [vec] = await embed([inp.query], "query");
  const sql = getSql();

  // pgvector requires the literal `[1,2,3]` text form for the vector parameter.
  const vecLiteral = `[${vec.join(",")}]`;

  let rows: any[] = [];
  try {
    rows = filter === "any"
      ? await sql`
          SELECT id, doc_class, doc_id, doc_title, source_label, page, text,
                 (embedding <-> ${vecLiteral}::vector) AS distance
          FROM corpus_chunks
          WHERE embedding IS NOT NULL
          ORDER BY embedding <-> ${vecLiteral}::vector
          LIMIT ${k}
        `
      : await sql`
          SELECT id, doc_class, doc_id, doc_title, source_label, page, text,
                 (embedding <-> ${vecLiteral}::vector) AS distance
          FROM corpus_chunks
          WHERE embedding IS NOT NULL AND doc_class = ${filter}
          ORDER BY embedding <-> ${vecLiteral}::vector
          LIMIT ${k}
        `;
  } catch (e) {
    console.error("search_corpus query failed:", e);
    rows = [];
  }

  return {
    query: inp.query,
    chunks: rows.map((r: any) => ({
      id: r.id,
      doc_class: r.doc_class,
      doc_id: r.doc_id,
      doc_title: r.doc_title,
      source_label: r.source_label,
      page: r.page,
      text: r.text,
      distance: Number(r.distance),
    })),
  };
}
