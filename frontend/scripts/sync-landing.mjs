// Copies the editable landing-page source (frontend/landing_page/) into
// public/landing/ so Next can serve it as a static site at /landing/*.
// public/landing/ is a generated artifact (gitignored) — only edit landing_page/.
import { cp, rm, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "..", "landing_page");
const dest = resolve(here, "..", "public", "landing");

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });

console.log(`[sync-landing] ${src} -> ${dest}`);
