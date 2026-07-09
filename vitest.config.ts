import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve the `dropsh` / `dropsh/plugin` self-references to source so unit
  // tests run without a build step (the package `exports` map points at
  // `dist/`, which CI does not build before `pnpm test`). Mirrors the tsconfig
  // `paths` mapping used for type-checking.
  resolve: {
    alias: {
      "dropsh/plugin": fileURLToPath(new URL("./src/plugin-api.ts", import.meta.url)),
      dropsh: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
