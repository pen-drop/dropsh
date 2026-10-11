import { Command } from "commander";
import { ConfigError, type PluginCommandServices } from "dropsh/plugin";
import { describe, expect, it } from "vitest";
import { mcpPlugin } from "../../src/index.js";

describe("mcpPlugin", () => {
  it("validates options at construction and registers mcp serve", () => {
    expect(() => mcpPlugin({})).toThrow(ConfigError);
    const plugin = mcpPlugin({
      bundles: ["node/article"],
      operations: ["read"],
    });
    expect(plugin.id).toBe("mcp");
    const program = new Command();
    const services: PluginCommandServices = {
      getContext: async () => {
        throw new Error("unused");
      },
      stderr: () => {},
    };
    plugin.registerCommands?.(program, services);
    const mcp = program.commands.find((c) => c.name() === "mcp");
    expect(mcp).toBeTruthy();
    const serve = mcp?.commands.find((c) => c.name() === "serve");
    expect(serve).toBeTruthy();
  });
});
