import { defineConfig } from "vitest/config";

export default defineConfig({
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
