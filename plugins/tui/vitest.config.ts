import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "dropsh/plugin": resolve(__dirname, "../../src/plugin-api.ts"),
      "@dropsh/plugin-markdown/render": resolve(__dirname, "../markdown/src/render-md.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
