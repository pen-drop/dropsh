import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve the `dropsh` / `dropsh/plugin` self-references to source, mirroring
  // the unit `vitest.config.ts`. The in-process helpers (`seedSession`) load the
  // provider and http client from source; without this alias `dropsh/plugin`
  // resolves via the package `exports` map to `dist/`, so the provider's
  // `instanceof HttpError` checks a different class than the source http client
  // throws — a rejected token request would then miss its RFC 6749 verdict.
  resolve: {
    alias: {
      "dropsh/plugin": fileURLToPath(new URL("./src/plugin-api.ts", import.meta.url)),
      dropsh: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/integrations/**/*.test.ts"],
    exclude: ["tests/integrations/drupal/web/**", "tests/integrations/drupal-schemata/web/**"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    sequence: { concurrent: false },
    fileParallelism: false,
  },
});
