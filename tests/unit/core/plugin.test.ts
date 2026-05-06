import { describe, expect, it } from "vitest";
import type { DrupalCliPlugin, PluginContext } from "../../../src/core/plugin.js";

const ctx: PluginContext = {
  http: { send: async () => ({ status: 200, headers: {}, body: "{}" }) },
  auth: { apply: async (req) => req },
  baseUrl: "https://example.com",
};

describe("DrupalCliPlugin interface", () => {
  it("accepts a plugin with only extendSchema", async () => {
    const plugin: DrupalCliPlugin = {
      id: "test",
      requiredModules: ["some_module"],
      async extendSchema(_entity, _bundle, schema, _ctx) { return schema; },
    };
    expect(plugin.id).toBe("test");
    expect(plugin.requiredModules).toEqual(["some_module"]);
    const schema = { type: "object" };
    const extended = await plugin.extendSchema("node", "article", schema, ctx);
    expect(extended).toBe(schema);
  });

  it("optional methods are absent on a minimal plugin", () => {
    const plugin: DrupalCliPlugin = {
      id: "minimal",
      requiredModules: [],
      async extendSchema(_e, _b, s) { return s; },
    };
    expect(plugin.createAuthAdapter).toBeUndefined();
    expect(plugin.registerCommands).toBeUndefined();
  });

  it("createAuthAdapter is optional and callable when present", () => {
    const adapter = { apply: async (req: any) => req };
    const plugin: DrupalCliPlugin = {
      id: "auth-plugin",
      requiredModules: [],
      createAuthAdapter: () => adapter,
      async extendSchema(_e, _b, s) { return s; },
    };
    expect(plugin.createAuthAdapter!()).toBe(adapter);
  });
});
