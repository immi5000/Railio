import "dotenv/config";
if (process.env.DATABASE_URL_DIRECT) process.env.DATABASE_URL = process.env.DATABASE_URL_DIRECT;
import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { getSql } from "../lib/db";
import { embed } from "../lib/embeddings";

type Source = {
  kind: "ecfr-xml" | "pdf";
  url: string;
  out_filename: string;
  doc_class: "manual" | "tribal_knowledge";
  doc_id: string;
  doc_title: string;
};

type Chunk = {
  doc_class: "manual" | "tribal_knowledge";
  doc_id: string;
  doc_title: string;
  source_label: string;
  page: number | null;
  text: string;
};

const here = path.resolve(__dirname, "..");
const manifestPath = path.join(here, "corpus-sources", "sources.json");
const rawDir = path.join(here, "corpus-sources", "raw");
const tribalPath = path.join(here, "seeds", "corpus-tribal.json");

// text-embedding-3-large supports ~8k tokens; 1 token ≈ 4 chars → ~30k char ceiling.
// We sub-split anything larger to stay comfortably under the limit.
const MAX_CHARS_PER_CHUNK = 6000;
const EMBED_BATCH = 96; // OpenAI embeddings API max inputs per request

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: false,
  textNodeName: "#text",
});

const SKIP_KEYS = new Set(["HEAD", "AUTH", "CITA", "SOURCE", "EFFDATE", "EDNOTE", "RESERVED", "EAR"]);

(async () => {
  const sources: Source[] = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const chunks: Chunk[] = [];

  // --- Tribal hand-written entries (kept) ---
  if (fs.existsSync(tribalPath)) {
    const tribal: Chunk[] = JSON.parse(fs.readFileSync(tribalPath, "utf8"));
    chunks.push(...tribal);
    console.log(`tribal: ${tribal.length} hand-written chunks`);
  }

  // --- Downloaded sources ---
  for (const s of sources) {
    const filePath = path.join(rawDir, s.out_filename);
    if (!fs.existsSync(filePath)) {
      console.warn(`skip ${s.out_filename}: not on disk. Run \`npm run corpus:fetch\`.`);
      continue;
    }
    if (s.kind === "ecfr-xml") {
      const xml = fs.readFileSync(filePath, "utf8");
      const parsed = xmlParser.parse(xml);
      const sectionChunks = chunkEcfr(parsed, s);
      chunks.push(...sectionChunks);
      console.log(`${s.out_filename}: ${sectionChunks.length} sections`);
    } else if (s.kind === "pdf") {
      console.warn(`pdf kind not yet implemented (${s.out_filename}); skipping`);
    }
  }

  console.log(`\ntotal: ${chunks.length} chunks. Embedding…`);

  // --- Wipe & insert ---
  const sql = getSql();
  // Bump the per-statement timeout — a multi-row INSERT of 96 rows × 1024-dim
  // vectors with HNSW index maintenance can exceed the default 2 min on Supabase.
  await sql`SET statement_timeout = '10min'`;
  await sql`DELETE FROM corpus_chunks`;
  await sql`SELECT setval(pg_get_serial_sequence('corpus_chunks', 'id'), 1, false)`;

  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const slice = chunks.slice(i, i + EMBED_BATCH);
    const vecs = await embed(
      slice.map((c) => c.text),
      "document"
    );
    // Multi-row INSERT in one statement — much faster than 96 round-trips.
    const rows = slice.map((c, j) => ({
      doc_class: c.doc_class,
      doc_id: c.doc_id,
      doc_title: c.doc_title,
      source_label: c.source_label,
      page: c.page,
      text: c.text,
      embedding: `[${vecs[j].join(",")}]`,
    }));
    await sql`
      INSERT INTO corpus_chunks ${sql(rows, "doc_class", "doc_id", "doc_title", "source_label", "page", "text", "embedding")}
    `;
    process.stdout.write(`  embedded ${Math.min(i + EMBED_BATCH, chunks.length)}/${chunks.length}\r`);
  }

  console.log(`corpus-build: ok. ${chunks.length} chunks loaded.`);
  await sql.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

// === eCFR XML chunking ===

// Walk the parsed object recursively and yield every node.
function* walk(node: any): Generator<any> {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const c of node) yield* walk(c);
    return;
  }
  yield node;
  for (const [key, val] of Object.entries(node)) {
    if (key.startsWith("@_") || key === "#text") continue;
    yield* walk(val);
  }
}

// Decode XML/HTML entities that fast-xml-parser leaves untouched in text.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, code) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    }
    return NAMED_ENTITIES[code] ?? _;
  });
}

// Recursively flatten any XML node back to a plain text string.
function textOf(node: any): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object") {
    let s = "";
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith("@_")) continue;
      s += textOf(v);
    }
    return s;
  }
  return "";
}

function chunkEcfr(parsed: any, src: Source): Chunk[] {
  const out: Chunk[] = [];
  for (const node of walk(parsed)) {
    if (node["@_TYPE"] !== "SECTION" || !node["@_N"]) continue;
    const sectionN: string = node["@_N"];
    const headRaw = decodeEntities(textOf(node.HEAD)).replace(/\s+/g, " ").trim();
    // "§ 229.21 Daily inspection." → strip the leading "§ N" since we already have it.
    const head = headRaw.replace(/^§\s*\S+\s*/, "").trim();

    const bodyParts: string[] = [];
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith("@_") || SKIP_KEYS.has(k)) continue;
      const t = decodeEntities(textOf(v)).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (t) bodyParts.push(t);
    }
    const body = bodyParts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!body) continue;

    const fullText = head ? `${head}\n\n${body}` : body;
    const sourceLabelBase = `49 CFR §${sectionN}${head ? ` — ${head}` : ""}`;

    if (fullText.length <= MAX_CHARS_PER_CHUNK) {
      out.push({
        doc_class: src.doc_class,
        doc_id: src.doc_id,
        doc_title: src.doc_title,
        source_label: sourceLabelBase,
        page: null,
        text: fullText,
      });
    } else {
      // Sub-split long sections at paragraph boundaries.
      const parts = subSplit(fullText, MAX_CHARS_PER_CHUNK);
      parts.forEach((p, i) => {
        out.push({
          doc_class: src.doc_class,
          doc_id: src.doc_id,
          doc_title: src.doc_title,
          source_label: `${sourceLabelBase} (part ${i + 1}/${parts.length})`,
          page: null,
          text: p,
        });
      });
    }
  }
  return out;
}

function subSplit(text: string, maxChars: number): string[] {
  const paragraphs = text.split(/\n\n+/);
  const out: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    if (buf.length + p.length + 2 <= maxChars) {
      buf = buf ? `${buf}\n\n${p}` : p;
    } else {
      if (buf) out.push(buf);
      if (p.length <= maxChars) {
        buf = p;
      } else {
        // Hard-split a single oversized paragraph.
        for (let i = 0; i < p.length; i += maxChars) out.push(p.slice(i, i + maxChars));
        buf = "";
      }
    }
  }
  if (buf) out.push(buf);
  return out;
}
