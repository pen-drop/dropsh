import { describe, expect, it, vi } from "vitest";
import { fetchJsonSchema } from "../../../../src/core/schema/jsonschema-source.js";
import { SCHEMATA_MISS } from "../../../../src/core/schema/sources/schemata.js";
import type { HttpClient } from "../../../../src/core/http.js";
import type { AuthAdapter } from "../../../../src/core/auth/types.js";
import { HttpError, ValidationError } from "../../../../src/errors.js";

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
  it("returns schemata output with source='schemata' when schemata 200", async () => {
    const http = scriptedHttp([
      { status: 200, body: JSON.stringify({ properties: { data: { type: "object" } } }) },
    ]);
    const { schema, source } = await fetchJsonSchema({
      http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi", entity: "node", bundle: "article", warn: () => {},
    });
    expect(source).toBe("schemata");
    expect((schema as any).properties.data.type).toBe("object");
  });

  it("falls back to heuristic with source='heuristic' on schemata 404 + sample data", async () => {
    const http = scriptedHttp([
      { status: 404, body: "" },
      { status: 200, body: JSON.stringify({ data: [{ type: "node--article", id: "x", attributes: { title: "A" }, relationships: {} }] }) },
    ]);
    const warnings: string[] = [];
    const { source } = await fetchJsonSchema({
      http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi", entity: "node", bundle: "article", warn: (m) => warnings.push(m),
    });
    expect(source).toBe("heuristic");
    expect(warnings.some((w) => /no 'schemata' module/.test(w))).toBe(true);
  });

  it("returns source='heuristic-empty' for bundle with no instances and no schemata", async () => {
    const http = scriptedHttp([
      { status: 404, body: "" },
      { status: 200, body: JSON.stringify({ data: [] }) },
    ]);
    const warnings: string[] = [];
    const { source } = await fetchJsonSchema({
      http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi", entity: "node", bundle: "empty", warn: (m) => warnings.push(m),
    });
    expect(source).toBe("heuristic-empty");
    expect(warnings.some((w) => /envelope-only/.test(w))).toBe(true);
  });

  it("throws ValidationError when both endpoints return 404", async () => {
    const http = scriptedHttp([
      { status: 404, body: "" },
      { status: 404, body: "" },
    ]);
    await expect(fetchJsonSchema({
      http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi", entity: "node", bundle: "ghost", warn: () => {},
    })).rejects.toBeInstanceOf(ValidationError);
  });
});
