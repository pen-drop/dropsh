import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginContext } from "dropsh/plugin";
import { HttpError } from "dropsh/plugin";
import { describe, expect, it, vi } from "vitest";
import { jsonapiSchemaPlugin } from "../../src/index.js";
import { buildWriteSchema } from "../../src/jsonapi-schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const resourceSchema = JSON.parse(
  readFileSync(resolve(here, "fixtures/node--article.resource.schema.json"), "utf8"),
);

// biome-ignore lint/suspicious/noExplicitAny: deep JSON structure from external module
function get(obj: any, path: string): any {
  return path.split(".").reduce((acc, k) => acc?.[k], obj);
}

interface CtxOverrides {
  responses?: Array<{ status: number; body: string }>;
  warn?: (m: string) => void;
}

function makeCtx(o: CtxOverrides = {}): PluginContext {
  const responses = o.responses ?? [];
  let i = 0;
  const ctx: PluginContext = {
    http: {
      send: async () => {
        // biome-ignore lint/style/noNonNullAssertion: test helper with bounded array
        const r = responses[i++]!;
        if (r.status >= 200 && r.status < 300)
          return { status: r.status, headers: {}, body: r.body };
        throw new HttpError(r.status, `HTTP ${r.status}`, r.body);
      },
    },
    auth: { apply: async (req) => req },
    baseUrl: "https://example.com",
    jsonapiPrefix: "/jsonapi",
  };
  if (o.warn) ctx.warn = o.warn;
  return ctx;
}

function firstWarning(warn: ReturnType<typeof vi.fn>): string {
  return String(warn.mock.calls[0]?.[0] ?? "");
}

describe("buildWriteSchema", () => {
  it("wraps the resource-object schema in a JSON:API document envelope", () => {
    const out = buildWriteSchema(resourceSchema);
    expect(get(out, "type")).toBe("object");
    expect(get(out, "required")).toEqual(["data"]);
    expect(get(out, "properties.data.type")).toBe("object");
  });

  it("inlines the attributes definition, preserving required fields", () => {
    const out = buildWriteSchema(resourceSchema);
    expect(get(out, "properties.data.properties.attributes.required")).toContain("title");
  });

  it("preserves attribute field constraints and formats", () => {
    const out = buildWriteSchema(resourceSchema);
    expect(get(out, "properties.data.properties.attributes.properties.title.maxLength")).toBe(255);
    expect(get(out, "properties.data.properties.attributes.properties.created.format")).toBe(
      "date-time",
    );
  });

  it("inlines the type const and relationships", () => {
    const out = buildWriteSchema(resourceSchema);
    expect(get(out, "properties.data.properties.type.const")).toBe("node--article");
    expect(get(out, "properties.data.properties.relationships.properties.field_tags")).toBeTruthy();
    expect(get(out, "properties.data.required")).toContain("type");
  });

  it("leaves no unresolvable absolute $ref that Ajv cannot compile", () => {
    const out = buildWriteSchema(resourceSchema);
    const json = JSON.stringify(out);
    expect(json).not.toContain("jsonapi.org");
    expect(json).not.toContain("https://");
    expect(json).not.toContain('"links"');
  });

  it("throws on a structurally unrecognizable schema", () => {
    expect(() => buildWriteSchema({ nonsense: true })).toThrow();
  });
});

describe("jsonapiSchemaPlugin", () => {
  it("id is jsonapi-schema", () => {
    expect(jsonapiSchemaPlugin().id).toBe("jsonapi-schema");
  });

  it("requiredModules is [jsonapi_schema]", () => {
    expect(jsonapiSchemaPlugin().requiredModules).toEqual(["jsonapi_schema"]);
  });

  it("returns the write schema (not baseSchema) when the endpoint returns 200", async () => {
    const plugin = jsonapiSchemaPlugin();
    const ctx = makeCtx({ responses: [{ status: 200, body: JSON.stringify(resourceSchema) }] });
    const base = { type: "object" };
    const result = await plugin.extendSchema!("node", "article", base, ctx);
    expect(result).not.toBe(base);
    expect(get(result, "properties.data.properties.attributes.required")).toContain("title");
  });

  it("falls back to baseSchema with an explanatory warning when the module is absent (404)", async () => {
    const warn = vi.fn();
    const plugin = jsonapiSchemaPlugin();
    const ctx = makeCtx({ responses: [{ status: 404, body: "" }], warn });
    const base = { type: "object", properties: {} };
    const result = await plugin.extendSchema!("node", "article", base, ctx);
    expect(result).toBe(base);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(firstWarning(warn)).toMatch(/jsonapi_schema/);
    expect(firstWarning(warn)).toMatch(/absent|not enabled|not installed/i);
  });

  it("surfaces a visible warning on a broken endpoint (5xx), never silent", async () => {
    const warn = vi.fn();
    const plugin = jsonapiSchemaPlugin();
    const ctx = makeCtx({ responses: [{ status: 500, body: "boom" }], warn });
    const base = { type: "object" };
    const result = await plugin.extendSchema!("node", "article", base, ctx);
    expect(result).toBe(base);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(firstWarning(warn)).toMatch(/broken|500|endpoint/i);
  });

  it("surfaces a visible warning on an unparseable body, never silent", async () => {
    const warn = vi.fn();
    const plugin = jsonapiSchemaPlugin();
    const ctx = makeCtx({ responses: [{ status: 200, body: "<html>not json</html>" }], warn });
    const base = { type: "object" };
    const result = await plugin.extendSchema!("node", "article", base, ctx);
    expect(result).toBe(base);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
