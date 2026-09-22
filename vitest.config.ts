import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vitest covers deterministic node-side unit logic (SQL validation, prompt
// assembly, schema context, dataset/event coverage). Playwright owns API,
// E2E, and visual tests — those dirs are excluded here so the two runners
// never overlap.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.{test,spec}.ts"],
    environment: "node",
  },
});
