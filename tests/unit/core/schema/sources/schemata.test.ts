import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSchemata, SCHEMATA_MISS } from "../../../../../src/core/schema/sources/schemata.js";
import type { HttpClient } from "../../../../../src/core/http.js";
import type { AuthAdapter } from "../../../../../src/core/auth/types.js";
import { HttpError } from "../../../../../src/errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const auth: AuthAdapter = { apply: async (req) => req };

function http(status: number, body: string): HttpClient {
  return {
    send: vi.fn(async () => {
      if (status >= 200 && status < 300) return { status, headers: {}, body };
      let parsed: unknown = body;
      try { parsed = JSON.parse(body); } catch { /* keep text */ }
      throw new HttpError(status, `HTTP ${status}`, parsed);
    }),
  };
}

describe("fetchSchemata", () => {
  it("returns the parsed JSON Schema on 200", async () => {
    const raw = readFileSync(resolve(__dirname, "../../../fixtures/schemata/node--article.schema.json"), "utf8");
    const res = await fetchSchemata({ http: http(200, raw), auth, baseUrl: "https://ex", entity: "node", bundle: "article" });
    expect(res).not.toBe(SCHEMATA_MISS);
    expect((res as any).properties.data.properties.attributes.required).toEqual(["title"]);
  });

  it("returns SCHEMATA_MISS on 404", async () => {
    const res = await fetchSchemata({ http: http(404, ""), auth, baseUrl: "https://ex", entity: "node", bundle: "article" });
    expect(res).toBe(SCHEMATA_MISS);
  });

  it("throws HttpError on 5xx", async () => {
    await expect(
      fetchSchemata({ http: http(503, ""), auth, baseUrl: "https://ex", entity: "node", bundle: "article" })
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("hits the documented URL with auth applied", async () => {
    const send = vi.fn(async () => ({ status: 200, headers: {}, body: "{}" }));
    const spyAuth: AuthAdapter = { apply: async (req) => ({ ...req, headers: { ...(req.headers ?? {}), Authorization: "Bearer x" } }) };
    await fetchSchemata({ http: { send }, auth: spyAuth, baseUrl: "https://ex/", entity: "node", bundle: "article" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      url: "https://ex/schemata/node/article?_format=schema_json&_describes=api_json",
      headers: expect.objectContaining({ Authorization: "Bearer x" }),
    }));
  });
});
