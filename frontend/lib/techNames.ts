// Deterministic-but-random tech names for tribal-knowledge chunks.
// Same chunk_id always maps to the same author so the UI stays stable
// between page loads and across views (library card, drawer, citation pill).

const FIRST_NAMES = ["Bob", "John", "Akshay", "Devan"];

const SHIFT_TAGS = ["1st shift", "2nd shift", "3rd shift", "swing", "yard"];

// Tiny FNV-1a 32-bit hash so we get a stable index from any string/number.
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function techNameForChunk(chunk: {
  id: number;
  doc_id: string;
}): { name: string; shift: string } {
  // Mix id and doc_id so notes from the same doc don't all get the same author,
  // and notes with the same id from different docs don't collide either.
  const h1 = hash(`${chunk.doc_id}#${chunk.id}`);
  const h2 = hash(`shift:${chunk.id}:${chunk.doc_id}`);
  const first = FIRST_NAMES[h1 % FIRST_NAMES.length];
  const shift = SHIFT_TAGS[h2 % SHIFT_TAGS.length];
  return { name: first, shift };
}
