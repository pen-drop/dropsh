import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
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
