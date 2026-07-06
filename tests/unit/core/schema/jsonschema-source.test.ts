import { describe, expect, it, vi } from "vitest";
import { fetchJsonSchema } from "../../../../src/core/schema/jsonschema-source.js";
import type { HttpClient } from "../../../../src/core/http.js";
import type { AuthAdapter } from "../../../../src/core/auth/types.js";
import { HttpError, ValidationError } from "../../../../src/errors.js";
import type { DropSHPlugin } from "../../../../src/core/plugin.js";

const auth: AuthAdapter = { apply: async (req) => req };

function scriptedHttp(responses: Array<{ status: number; body: string }>): HttpClient {
  let i = 0;
  return {
    send: vi.fn(async () => {
      const r = responses[i++]!;
      if (r.status >= 200 && r.status < 300) return { headers: {}, ...r };
      let parsed: unknown = r.body;
      try { parsed = JSON.parse(r.body); } catch { /* keep text */ }
      throw new HttpError(r.status, `HTTP ${r.status}`, parsed);
    }),
  };
}

describe("fetchJsonSchema", () => {
  it("returns source='heuristic' with no plugins and sample data available", async () => {
    const http = scriptedHttp([
      { status: 200, body: JSON.stringify({ data: [{ type: "node--article", id: "x", attributes: { title: "A" }, relationships: {} }] }) },
    ]);
    const warnings: string[] = [];
    const { source } = await fetchJsonSchema({
      http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi",
      entity: "node", bundle: "article", warn: (m) => warnings.push(m),
      plugins: [],
    });
    expect(source).toBe("heuristic");
    expect(warnings.some((w) => /heuristic schema/.test(w))).toBe(true);
  });

  it("returns source='heuristic-empty' for bundle with no instances and no plugins", async () => {
    const http = scriptedHttp([
      { status: 200, body: JSON.stringify({ data: [] }) },
    ]);
    const warnings: string[] = [];
    const { source } = await fetchJsonSchema({
      http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi",
      entity: "node", bundle: "empty", warn: (m) => warnings.push(m),
      plugins: [],
    });
    expect(source).toBe("heuristic-empty");
    expect(warnings.some((w) => /envelope-only/.test(w))).toBe(true);
  });

  it("throws ValidationError when heuristic endpoint returns 404", async () => {
    const http = scriptedHttp([
      { status: 404, body: "" },
    ]);
    await expect(fetchJsonSchema({
      http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi",
      entity: "node", bundle: "ghost", warn: () => {},
      plugins: [],
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it("returns source='plugin' when a plugin extends the schema", async () => {
    const http = scriptedHttp([
      { status: 200, body: JSON.stringify({ data: [{ type: "node--article", id: "x", attributes: { title: "A" }, relationships: {} }] }) },
    ]);
    const pluginSchema = { type: "object", properties: { data: { type: "object" } } };
    const mockPlugin: DropSHPlugin = {
      id: "mock",
      requiredModules: [],
      async extendSchema(_e, _b, _base, _ctx) { return pluginSchema; },
    };
    const { schema, source } = await fetchJsonSchema({
      http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi",
      entity: "node", bundle: "article", warn: () => {},
      plugins: [mockPlugin],
    });
    expect(source).toBe("mock");
    expect(schema).toBe(pluginSchema);
  });

  it("returns original schema unchanged when plugin returns same object reference", async () => {
    const http = scriptedHttp([
      { status: 200, body: JSON.stringify({ data: [{ type: "node--article", id: "x", attributes: { title: "A" }, relationships: {} }] }) },
    ]);
    const mockPlugin: DropSHPlugin = {
      id: "passthrough",
      requiredModules: [],
      async extendSchema(_e, _b, base, _ctx) { return base; },
    };
    const { source } = await fetchJsonSchema({
      http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi",
      entity: "node", bundle: "article", warn: () => {},
      plugins: [mockPlugin],
    });
    expect(source).toBe("heuristic");
  });
});
