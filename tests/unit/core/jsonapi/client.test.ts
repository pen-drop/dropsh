import { describe, expect, it, vi } from "vitest";
import { createJsonApiClient } from "../../../../src/core/jsonapi/client.js";
import type { HttpClient, HttpRequest } from "../../../../src/core/http.js";
import type { AuthAdapter } from "../../../../src/core/auth/types.js";

function httpStub(respond: (req: HttpRequest) => { status: number; body: string }): HttpClient {
  return { async send(req) { const r = respond(req); return { status: r.status, headers: {}, body: r.body }; } };
}

const passthroughAuth: AuthAdapter = { apply: async (r) => r };

describe("JsonApiClient", () => {
  it("GET builds full URL with prefix and query string", async () => {
    const http = httpStub((req) => {
      expect(req.method).toBe("GET");
      expect(req.url).toBe("https://site/jsonapi/node/article?filter%5Btitle%5D%5Bvalue%5D=X");
      return { status: 200, body: '{"data":[]}' };
    });
    const client = createJsonApiClient({ baseUrl: "https://site", prefix: "/jsonapi", http, auth: passthroughAuth });
    const res = await client.get("node/article", { filter: [{ key: "title", value: "X" }] });
    expect(res).toEqual({ data: [] });
  });

  it("POST sends JSON body with content-type and returns parsed response", async () => {
    const http = httpStub((req) => {
      expect(req.method).toBe("POST");
      expect(req.headers?.["Content-Type"]).toBe("application/vnd.api+json");
      expect(req.headers?.Accept).toBe("application/vnd.api+json");
      expect(req.body).toBe('{"data":{"type":"node--article"}}');
      return { status: 201, body: '{"data":{"id":"u1"}}' };
    });
    const client = createJsonApiClient({ baseUrl: "https://site", prefix: "/jsonapi", http, auth: passthroughAuth });
    const res = await client.post("node/article", { data: { type: "node--article" } });
    expect(res).toEqual({ data: { id: "u1" } });
  });

  it("PATCH to /node/article/<uuid>", async () => {
    const calls: HttpRequest[] = [];
    const http: HttpClient = { async send(req) { calls.push(req); return { status: 200, headers: {}, body: '{"data":{}}' }; } };
    const client = createJsonApiClient({ baseUrl: "https://site/", prefix: "/jsonapi", http, auth: passthroughAuth });
    await client.patch("node/article/abc", { data: {} });
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.url).toBe("https://site/jsonapi/node/article/abc");
  });

  it("DELETE", async () => {
    const http = httpStub((req) => { expect(req.method).toBe("DELETE"); return { status: 204, body: "" }; });
    const client = createJsonApiClient({ baseUrl: "https://site", prefix: "/jsonapi", http, auth: passthroughAuth });
    const res = await client.delete("node/article/abc");
    expect(res).toEqual({ ok: true });
  });

  it("applies auth adapter", async () => {
    const authSpy = vi.fn<AuthAdapter["apply"]>(async (r) => ({ ...r, headers: { ...r.headers, Authorization: "X" } }));
    const http = httpStub((req) => { expect(req.headers?.Authorization).toBe("X"); return { status: 200, body: "{}" }; });
    const client = createJsonApiClient({ baseUrl: "https://site", prefix: "/jsonapi", http, auth: { apply: authSpy } });
    await client.get("node/article");
    expect(authSpy).toHaveBeenCalledOnce();
  });

  it("upload sends binary body with Content-Disposition", async () => {
    const http = httpStub((req) => {
      expect(req.method).toBe("POST");
      expect(req.url).toBe("https://site/jsonapi/node/article/u1/field_image");
      expect(req.headers?.["Content-Type"]).toBe("application/octet-stream");
      expect(req.headers?.["Content-Disposition"]).toBe('file; filename="hero.jpg"');
      return { status: 201, body: '{"data":{"id":"file-uuid"}}' };
    });
    const client = createJsonApiClient({ baseUrl: "https://site", prefix: "/jsonapi", http, auth: passthroughAuth });
    const res = await client.upload("node/article/u1/field_image", "hero.jpg", Buffer.from("binarydata"));
    expect(res).toEqual({ data: { id: "file-uuid" } });
  });
});
