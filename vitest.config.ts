import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Each test file gets its own in-memory / temp DB, so parallel files are safe.
    pool: "threads",
  },
});
