import { describe, expect, it } from "vitest";
import { composePlugins, type DropSHPlugin, type PluginContext } from "../../../src/core/plugin.js";

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
      async extendSchema(_entity, _bundle, schema, _ctx) {
        return schema;
      },
    };
    expect(plugin.id).toBe("test");
    expect(plugin.requiredModules).toEqual(["some_module"]);
    const schema = { type: "object" };
    const extended = await plugin.extendSchema!("node", "article", schema, ctx);
    expect(extended).toBe(schema);
  });

  it("optional methods are absent on a minimal plugin", () => {
    const plugin: DropSHPlugin = {
      id: "minimal",
      requiredModules: [],
    };
    expect(plugin.authProvider).toBeUndefined();
    expect(plugin.extendSchema).toBeUndefined();
    expect(plugin.registerCommands).toBeUndefined();
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

  it("accepts an async alterRequest hook with request context", async () => {
    const plugin: DropSHPlugin = {
      id: "tenant",
      requiredModules: [],
      async alterRequest(req, requestCtx) {
        expect(requestCtx.operation).toBe("create");
        expect(requestCtx.entityType).toBe("gaia_ticket");
        expect(requestCtx.bundle).toBe("gaia_ticket");
        return { ...req, headers: { ...req.headers, "X-Plugin": plugin.id } };
      },
    };

    const altered = await plugin.alterRequest?.(
      { method: "POST", url: "https://example.com/jsonapi/gaia_ticket/gaia_ticket" },
      {
        ...ctx,
        operation: "create",
        entityType: "gaia_ticket",
        bundle: "gaia_ticket",
      },
    );

    expect(altered?.headers?.["X-Plugin"]).toBe("tenant");
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
        async login() {
          return {};
        },
        async logout() {},
        async status() {
          return { loggedIn: false };
        },
        createAdapter() {
          return {
            async apply(r) {
              return r;
            },
          };
        },
      },
      async extendSchema(_e, _b, s) {
        return s;
      },
    };
    expect(plugin.authProvider?.id).toBe("x");
  });
});

describe("composePlugins", () => {
  const p = (id: string): DropSHPlugin => ({ id, requiredModules: [] });

  it("returns child plugins as a flat array", () => {
    expect(composePlugins(p("a"), p("b")).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("flattens one level of nested child arrays (composed composites)", () => {
    expect(composePlugins(p("a"), [p("b"), p("c")]).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array with no children", () => {
    expect(composePlugins()).toEqual([]);
  });
});
