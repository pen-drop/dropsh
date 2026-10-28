import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dropshRoot = dirname(fileURLToPath(import.meta.resolve("dropsh/package.json")));

export default defineConfig({
  resolve: {
    alias: {
      "dropsh/plugin": resolve(dropshRoot, "src/plugin-api.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
