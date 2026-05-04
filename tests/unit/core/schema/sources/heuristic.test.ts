import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchHeuristic } from "../../../../../src/core/schema/sources/heuristic.js";
import type { HttpClient } from "../../../../../src/core/http.js";
import type { AuthAdapter } from "../../../../../src/core/auth/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const auth: AuthAdapter = { apply: async (req) => req };

function http(body: string): HttpClient {
  return { send: vi.fn(async () => ({ status: 200, headers: {}, body })) };
}

describe("fetchHeuristic", () => {
  it("builds shallow schema from 3 sample records", async () => {
    const body = readFileSync(resolve(__dirname, "../../../fixtures/samples/node--article-3-records.json"), "utf8");
    const { schema, empty } = await fetchHeuristic({ http: http(body), auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi", entity: "node", bundle: "article" });
    expect(empty).toBe(false);
    const attrs = (schema as any).properties.data.properties.attributes.properties;
    expect(attrs.title.type).toBe("string");
    expect(attrs.status.type).toBe("boolean");
    expect(Array.isArray(attrs.sticky.type)).toBe(true);
    expect(attrs.sticky.type).toEqual(expect.arrayContaining(["boolean", "null"]));
    expect(attrs.body.type).toEqual(expect.arrayContaining(["object", "null"]));
    expect((schema as any).properties.data.properties.attributes.required).toEqual([]);
  });

  it("includes relationship keys with data {type, id} shape", async () => {
    const body = readFileSync(resolve(__dirname, "../../../fixtures/samples/node--article-3-records.json"), "utf8");
    const { schema } = await fetchHeuristic({ http: http(body), auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi", entity: "node", bundle: "article" });
    const rels = (schema as any).properties.data.properties.relationships.properties;
    expect(rels.uid).toBeDefined();
    expect(rels.field_tags).toBeDefined();
  });

  it("returns empty-flag true for a bundle with no instances", async () => {
    const empty = readFileSync(resolve(__dirname, "../../../fixtures/samples/node--empty-bundle.json"), "utf8");
    const result = await fetchHeuristic({ http: http(empty), auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi", entity: "node", bundle: "empty" });
    expect(result.empty).toBe(true);
    const t = (result.schema as any).properties.data.properties.type;
    expect(t.const).toBe("node--empty");
  });

  it("requests the correct URL with page[limit]=3", async () => {
    const send = vi.fn(async () => ({ status: 200, headers: {}, body: JSON.stringify({ data: [] }) }));
    await fetchHeuristic({ http: { send }, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi", entity: "node", bundle: "article" });
    const callArgs = (send as any).mock.calls[0][0];
    expect(callArgs.method).toBe("GET");
    expect(callArgs.url).toBe("https://ex/jsonapi/node/article?page%5Blimit%5D=3");
  });
});
