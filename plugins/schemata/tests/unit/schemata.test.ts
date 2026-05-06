import { describe, expect, it } from "vitest";
import type { PluginContext } from "drupal-cli/plugin";
import { HttpError } from "drupal-cli/plugin";
import { schemataPlugin } from "../../src/index.js";

function makeCtx(responses: Array<{ status: number; body: string }>): PluginContext {
  let i = 0;
  return {
    http: {
      send: async () => {
        // biome-ignore lint/style/noNonNullAssertion: test helper with known-bounded array
        const r = responses[i++]!;
        if (r.status >= 200 && r.status < 300)
          return { status: r.status, headers: {}, body: r.body };
        throw new HttpError(r.status, `HTTP ${r.status}`, r.body);
      },
    },
    auth: { apply: async (req) => req },
    baseUrl: "https://example.com",
  };
}

describe("schemataPlugin", () => {
  it("returns schemata schema when endpoint returns 200", async () => {
    const plugin = schemataPlugin();
    const schemataSchema = { properties: { data: { type: "object" } } };
    const ctx = makeCtx([{ status: 200, body: JSON.stringify(schemataSchema) }]);
    const result = await plugin.extendSchema("node", "article", { type: "object" }, ctx);
    expect(result).toEqual(schemataSchema);
  });

  it("returns baseSchema when endpoint returns 404", async () => {
    const plugin = schemataPlugin();
    const base = { type: "object", properties: {} };
    const ctx = makeCtx([{ status: 404, body: "" }]);
    const result = await plugin.extendSchema("node", "article", base, ctx);
    expect(result).toBe(base);
  });

  it("returns baseSchema on any HttpError", async () => {
    const plugin = schemataPlugin();
    const base = { type: "object" };
    const ctx = makeCtx([{ status: 500, body: "error" }]);
    const result = await plugin.extendSchema("node", "article", base, ctx);
    expect(result).toBe(base);
  });

  it("id is schemata", () => {
    expect(schemataPlugin().id).toBe("schemata");
  });

  it("requiredModules includes schemata and jsonapi_schema", () => {
    expect(schemataPlugin().requiredModules).toContain("schemata");
    expect(schemataPlugin().requiredModules).toContain("jsonapi_schema");
  });
});
