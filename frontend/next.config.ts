import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Pin Turbopack's workspace root to this directory. Without it, stray lockfiles
// higher in the monorepo make Turbopack infer the repo root and watch the entire
// tree (backend/, railio-ingest/), which freezes the machine on compile.
const here = dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  turbopack: {
    root: here,
  },
};

export default config;
