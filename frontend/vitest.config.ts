import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Aliases mirror tsconfig.json's paths — vitest doesn't read them.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@contract": fileURLToPath(new URL("../contract/contract.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
