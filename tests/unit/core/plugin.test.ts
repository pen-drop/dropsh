import { describe, expect, it } from "vitest";
import type { DropSHPlugin, PluginContext } from "../../../src/core/plugin.js";

const ctx: PluginContext = {
  http: { send: async () => ({ status: 200, headers: {}, body: "{}" }) },
  auth: { apply: async (req) => req },
  baseUrl: "https://example.com",
};

describe("DropSHPlugin interface", () => {
  it("accepts a plugin with only extendSchema", async () => {
    const plugin: DropSHPlugin = {
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
    const plugin: DropSHPlugin = {
      id: "minimal",
      requiredModules: [],
      async extendSchema(_e, _b, s) { return s; },
    };
    expect(plugin.createAuthAdapter).toBeUndefined();
    expect(plugin.registerCommands).toBeUndefined();
  });

  it("createAuthAdapter is optional and callable when present", () => {
    const adapter = { apply: async (req: any) => req };
    const plugin: DropSHPlugin = {
      id: "auth-plugin",
      requiredModules: [],
      createAuthAdapter: () => adapter,
      async extendSchema(_e, _b, s) { return s; },
    };
    expect(plugin.createAuthAdapter!()).toBe(adapter);
  });

  it("accepts an optional operation-aware schema hook", async () => {
    const plugin: DropSHPlugin = {
      id: "builder",
      requiredModules: ["jsonapi_sdc"],
      async extendSchema(_e, _b, s) {
        return s;
      },
      async extendOperationSchema(_entity, _bundle, operation, schema, _ctx) {
        return {
          ...(schema as Record<string, unknown>),
          "x-test-operation": operation,
        };
      },
    };

    const schema = { type: "object" };
    const extended = await plugin.extendOperationSchema!(
      "canvas_page",
      "canvas_page",
      "create",
      schema,
      ctx,
    );

    expect(extended).toEqual({ type: "object", "x-test-operation": "create" });
  });
});

describe("DropSHPlugin", () => {
  it("allows an optional authProvider field", () => {
    const plugin: DropSHPlugin = {
      id: "x",
      requiredModules: [],
      authProvider: {
        id: "x",
        displayName: "X",
        capabilities: { login: true, logout: true, status: true },
        async login() { return {}; },
        async logout() {},
        async status() { return { loggedIn: false }; },
        createAdapter() { return { async apply(r) { return r; } }; },
      },
      async extendSchema(_e, _b, s) { return s; },
    };
    expect(plugin.authProvider?.id).toBe("x");
  });
});
