import { readFile } from "node:fs/promises";
import { buildProgram } from "dropsh";
import { ConfigError } from "dropsh/plugin";
import { describe, expect, it } from "vitest";
import { toolPlugin } from "../../src/index.js";

const has = (plugins: Parameters<typeof buildProgram>[0]) =>
  buildProgram(plugins).commands.some((c) => c.name() === "tool");

describe("toolPlugin", () => {
  it("validates its options at construction", () => {
    expect(() => toolPlugin({ endpoint: "mcp" })).toThrow(ConfigError);
    expect(toolPlugin().id).toBe("tool");
  });

  it("registers dropsh tool only when the plugin is configured", () => {
    expect(has({ plugins: [] })).toBe(false);
    expect(has({ plugins: [toolPlugin()] })).toBe(true);
  });

  it("keeps the MCP SDK out of the dropsh package's runtime dependencies", async () => {
    const root = JSON.parse(
      await readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(root.dependencies?.["@modelcontextprotocol/sdk"]).toBeUndefined();
  });
});
