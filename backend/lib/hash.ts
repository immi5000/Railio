import { createHash } from "node:crypto";

// sha256(prev_hash || canonical(row))
export function chainHash(prev: string | null, payload: object): string {
  const h = createHash("sha256");
  h.update(prev ?? "");
  h.update("\x00");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}
