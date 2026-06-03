import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { defineConfig } from "vitest/config";

const dropshRoot = dirname(fileURLToPath(import.meta.resolve("dropsh/package.json")));
const sdcClientRoot = dirname(
  fileURLToPath(import.meta.resolve("@dropsh/sdc-client/package.json")),
);

export default defineConfig({
  resolve: {
    alias: {
      "dropsh/plugin": resolve(dropshRoot, "src/plugin-api.ts"),
      "@dropsh/sdc-client": resolve(sdcClientRoot, "src/index.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
