import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCatalog } from "../../../../src/core/schema/catalog.js";
import type { HttpClient } from "../../../../src/core/http.js";
import type { AuthAdapter } from "../../../../src/core/auth/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function httpWithBody(body: string): HttpClient {
  return { send: vi.fn(async () => ({ status: 200, headers: {}, body })) };
}

const auth: AuthAdapter = { apply: async (req) => req };

describe("fetchCatalog", () => {
  it("parses the JSON:API root index into entity/bundle/label", async () => {
    const body = readFileSync(resolve(__dirname, "../../fixtures/jsonapi-root.json"), "utf8");
    const http = httpWithBody(body);
    const result = await fetchCatalog({ http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi" });
    expect(result).toEqual([
      { entity_type: "node", bundle: "article", label: "Article" },
      { entity_type: "node", bundle: "page", label: "Basic page" },
      { entity_type: "taxonomy_term", bundle: "tags", label: "Tags" },
      { entity_type: "user", bundle: "user", label: "User" },
    ]);
  });

  it("skips non-resource links like 'self'", async () => {
    const body = JSON.stringify({ links: { self: { href: "x" }, "node--article": { href: "y" } } });
    const result = await fetchCatalog({ http: httpWithBody(body), auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi" });
    expect(result.map((r) => r.entity_type + "--" + r.bundle)).toEqual(["node--article"]);
  });

  it("falls back to titled machine name when meta.title is missing", async () => {
    const body = JSON.stringify({ links: { "node--basic_page": { href: "x" } } });
    const rows = await fetchCatalog({ http: httpWithBody(body), auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi" });
    expect(rows[0]!.label).toBe("Basic page");
  });

  it("requests GET <baseUrl><jsonapiPrefix> with auth applied", async () => {
    const send = vi.fn(async () => ({ status: 200, headers: {}, body: JSON.stringify({ links: {} }) }));
    const spyAuth: AuthAdapter = { apply: async (req) => ({ ...req, headers: { ...(req.headers ?? {}), Authorization: "Bearer x" } }) };
    await fetchCatalog({ http: { send }, auth: spyAuth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      url: "https://ex/jsonapi",
      headers: expect.objectContaining({ Authorization: "Bearer x" }),
    }));
  });
});
