// Small embeddings client. Picks OpenAI (default), Voyage, or Cohere based on env.
// Output is always a 1024-dim float vector to match corpus_chunks.embedding (pgvector).

import { getOpenAI } from "./openai";

const PROVIDER = (process.env.EMBEDDINGS_PROVIDER ?? "openai").toLowerCase();

export async function embed(
  texts: string[],
  inputType: "document" | "query" = "document"
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (PROVIDER === "openai") return embedOpenAI(texts);
  if (PROVIDER === "voyage") return embedVoyage(texts, inputType);
  if (PROVIDER === "cohere") return embedCohere(texts, inputType);
  throw new Error(`Unknown EMBEDDINGS_PROVIDER: ${PROVIDER}`);
}

async function embedOpenAI(texts: string[]): Promise<number[][]> {
  const client = getOpenAI();
  const model = process.env.OPENAI_EMBEDDINGS_MODEL ?? "text-embedding-3-large";
  const r = await client.embeddings.create({
    model,
    input: texts,
    // Truncate to 1024 dims (text-embedding-3-* support the `dimensions` param via Matryoshka).
    dimensions: 1024,
  });
  return r.data.map((d) => d.embedding as number[]);
}

async function embedVoyage(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY missing");
  const model = process.env.EMBEDDINGS_MODEL ?? "voyage-3-large";
  const r = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, input: texts, input_type: inputType, output_dimension: 1024 }),
  });
  if (!r.ok) throw new Error(`voyage ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { data: { embedding: number[] }[] };
  return j.data.map((d) => d.embedding);
}

async function embedCohere(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  const key = process.env.COHERE_API_KEY;
  if (!key) throw new Error("COHERE_API_KEY missing");
  const model = process.env.EMBEDDINGS_MODEL ?? "embed-v3";
  const r = await fetch("https://api.cohere.com/v2/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      texts,
      input_type: inputType === "document" ? "search_document" : "search_query",
      embedding_types: ["float"],
    }),
  });
  if (!r.ok) throw new Error(`cohere ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { embeddings: { float: number[][] } };
  return j.embeddings.float;
}

