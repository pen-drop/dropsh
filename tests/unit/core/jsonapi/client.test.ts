import { describe, expect, it, vi } from "vitest";
import { DrupalJsonApiParams } from "drupal-jsonapi-params";
import { createJsonApiClient } from "../../../../src/core/jsonapi/client.js";
import type { HttpClient, HttpRequest } from "../../../../src/core/http.js";
import type { AuthAdapter } from "../../../../src/core/auth/types.js";
import { HttpError } from "../../../../src/errors.js";

function httpStub(respond: (req: HttpRequest) => { status: number; body: string }): HttpClient {
  return {
    async send(req) {
      const r = respond(req);
      return { status: r.status, headers: {}, body: r.body };
    },
  };
}

const passthroughAuth: AuthAdapter = { apply: async (r) => r };

describe("JsonApiClient", () => {
  it("GET builds full URL with prefix and query string from params", async () => {
    const http = httpStub((req) => {
      expect(req.method).toBe("GET");
      expect(req.url).toBe("https://site/jsonapi/node/article?filter%5Btitle%5D=X");
      return { status: 200, body: '{"data":[]}' };
    });
    const client = createJsonApiClient({
      baseUrl: "https://site",
      prefix: "/jsonapi",
      http,
      auth: passthroughAuth,
    });
    const params = new DrupalJsonApiParams().addFilter("title", "X");
    const res = await client.get("node/article", params);
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
    const client = createJsonApiClient({
      baseUrl: "https://site",
      prefix: "/jsonapi",
      http,
      auth: passthroughAuth,
    });
    const res = await client.post("node/article", { data: { type: "node--article" } });
    expect(res).toEqual({ data: { id: "u1" } });
  });

  it("PATCH to /node/article/<uuid>", async () => {
    const calls: HttpRequest[] = [];
    const http: HttpClient = {
      async send(req) {
        calls.push(req);
        return { status: 200, headers: {}, body: '{"data":{}}' };
      },
    };
    const client = createJsonApiClient({
      baseUrl: "https://site/",
      prefix: "/jsonapi",
      http,
      auth: passthroughAuth,
    });
    await client.patch("node/article/abc", { data: {} });
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.url).toBe("https://site/jsonapi/node/article/abc");
  });

  it("DELETE", async () => {
    const http = httpStub((req) => {
      expect(req.method).toBe("DELETE");
      return { status: 204, body: "" };
    });
    const client = createJsonApiClient({
      baseUrl: "https://site",
      prefix: "/jsonapi",
      http,
      auth: passthroughAuth,
    });
    const res = await client.delete("node/article/abc");
    expect(res).toEqual({ ok: true });
  });

  it("applies auth adapter", async () => {
    const authSpy = vi.fn<AuthAdapter["apply"]>(async (r) => ({
      ...r,
      headers: { ...r.headers, Authorization: "X" },
    }));
    const http = httpStub((req) => {
      expect(req.headers?.Authorization).toBe("X");
      return { status: 200, body: "{}" };
    });
    const client = createJsonApiClient({
      baseUrl: "https://site",
      prefix: "/jsonapi",
      http,
      auth: { apply: authSpy },
    });
    await client.get("node/article");
    expect(authSpy).toHaveBeenCalledOnce();
  });

  it("on 401 renews via the adapter and retries the request once", async () => {
    let call = 0;
    const http: HttpClient = {
      async send(req) {
        call += 1;
        // First attempt: server rejects the (stale) token.
        if (call === 1) throw new HttpError(401, "HTTP 401");
        // Retry after renewal carries the fresh token.
        expect(req.headers?.Authorization).toBe("Bearer fresh");
        return { status: 200, headers: {}, body: '{"data":{"id":"ok"}}' };
      },
    };
    let token = "stale";
    const auth: AuthAdapter = {
      apply: async (r) => ({ ...r, headers: { ...r.headers, Authorization: `Bearer ${token}` } }),
      renew: vi.fn(async () => {
        token = "fresh";
        return { ok: true };
      }),
    };
    const client = createJsonApiClient({ baseUrl: "https://site", prefix: "/jsonapi", http, auth });
    const res = await client.get("node/article");
    expect(res).toEqual({ data: { id: "ok" } });
    expect(auth.renew).toHaveBeenCalledOnce();
    expect(call).toBe(2);
  });

  it("surfaces the 401 when the adapter cannot renew", async () => {
    const http: HttpClient = {
      async send() {
        throw new HttpError(401, "HTTP 401");
      },
    };
    const auth: AuthAdapter = { apply: async (r) => r, renew: async () => ({ ok: false }) };
    const client = createJsonApiClient({ baseUrl: "https://site", prefix: "/jsonapi", http, auth });
    await expect(client.get("node/article")).rejects.toThrow(HttpError);
  });

  it("does not retry a 401 when the adapter has no renew (e.g. basic auth)", async () => {
    let call = 0;
    const http: HttpClient = {
      async send() {
        call += 1;
        throw new HttpError(401, "HTTP 401");
      },
    };
    const client = createJsonApiClient({
      baseUrl: "https://site",
      prefix: "/jsonapi",
      http,
      auth: passthroughAuth,
    });
    await expect(client.get("node/article")).rejects.toThrow(HttpError);
    expect(call).toBe(1);
  });

  it("does not retry non-401 errors", async () => {
    let call = 0;
    const http: HttpClient = {
      async send() {
        call += 1;
        throw new HttpError(500, "HTTP 500");
      },
    };
    const auth: AuthAdapter = { apply: async (r) => r, renew: vi.fn(async () => ({ ok: true })) };
    const client = createJsonApiClient({ baseUrl: "https://site", prefix: "/jsonapi", http, auth });
    await expect(client.get("node/article")).rejects.toThrow(HttpError);
    expect(auth.renew).not.toHaveBeenCalled();
    expect(call).toBe(1);
  });

  it("upload sends binary body with Content-Disposition", async () => {
    const http = httpStub((req) => {
      expect(req.method).toBe("POST");
      expect(req.url).toBe("https://site/jsonapi/node/article/u1/field_image");
      expect(req.headers?.["Content-Type"]).toBe("application/octet-stream");
      expect(req.headers?.["Content-Disposition"]).toBe('file; filename="hero.jpg"');
      return { status: 201, body: '{"data":{"id":"file-uuid"}}' };
    });
    const client = createJsonApiClient({
      baseUrl: "https://site",
      prefix: "/jsonapi",
      http,
      auth: passthroughAuth,
    });
    const res = await client.upload(
      "node/article/u1/field_image",
      "hero.jpg",
      Buffer.from("binarydata"),
    );
    expect(res).toEqual({ data: { id: "file-uuid" } });
  });
});

describe("JsonApiClient ergonomic layer", () => {
  it("resource() GETs entity/bundle/<id> and maps to a Resource", async () => {
    const http = httpStub((req) => {
      expect(req.method).toBe("GET");
      expect(req.url).toBe("https://site/jsonapi/gaia_run/gaia_run/r1");
      return {
        status: 200,
        body: '{"data":{"id":"r1","type":"gaia_run--gaia_run","attributes":{"title":"T"}}}',
      };
    });
    const client = createJsonApiClient({
      baseUrl: "https://site",
      prefix: "/jsonapi",
      http,
      auth: passthroughAuth,
    });
    const r = await client.resource("gaia_run", "r1");
    expect(r.id).toBe("r1");
    expect(r.attr("title")).toBe("T");
  });

  it("create() POSTs a {data:{type,...}} envelope and returns a Resource", async () => {
    const http = httpStub((req) => {
      expect(req.method).toBe("POST");
      expect(req.url).toBe("https://site/jsonapi/node/article");
      expect(JSON.parse(req.body as string)).toEqual({
        data: { type: "node--article", attributes: { title: "New" } },
      });
      return {
        status: 201,
        body: '{"data":{"id":"n1","type":"node--article","attributes":{"title":"New"}}}',
      };
    });
    const client = createJsonApiClient({
      baseUrl: "https://site",
      prefix: "/jsonapi",
      http,
      auth: passthroughAuth,
    });
    const r = await client.create("node/article", { attributes: { title: "New" } });
    expect(r.id).toBe("n1");
    expect(r.attr("title")).toBe("New");
  });

  it("update() PATCHes entity/bundle/<id> with a {data:{type,id,...}} envelope", async () => {
    const calls: HttpRequest[] = [];
    const http: HttpClient = {
      async send(req) {
        calls.push(req);
        return {
          status: 200,
          headers: {},
          body: '{"data":{"id":"n1","type":"node--article","attributes":{"title":"Up"}}}',
        };
      },
    };
    const client = createJsonApiClient({
      baseUrl: "https://site",
      prefix: "/jsonapi",
      http,
      auth: passthroughAuth,
    });
    const r = await client.update("node/article", "n1", { attributes: { title: "Up" } });
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.url).toBe("https://site/jsonapi/node/article/n1");
    expect(JSON.parse(calls[0]!.body as string)).toEqual({
      data: { type: "node--article", id: "n1", attributes: { title: "Up" } },
    });
    expect(r.attr("title")).toBe("Up");
  });

  it("upsert() PATCHes the existing match when one is found", async () => {
    const calls: HttpRequest[] = [];
    const http: HttpClient = {
      async send(req) {
        calls.push(req);
        if (req.method === "GET") {
          return {
            status: 200,
            headers: {},
            body: '{"data":[{"id":"n1","type":"node--article","attributes":{"title":"Old"}}]}',
          };
        }
        return {
          status: 200,
          headers: {},
          body: '{"data":{"id":"n1","type":"node--article","attributes":{"title":"Merged"}}}',
        };
      },
    };
    const client = createJsonApiClient({
      baseUrl: "https://site",
      prefix: "/jsonapi",
      http,
      auth: passthroughAuth,
    });
    const r = await client.upsert(
      "node/article",
      { path: "field_key", value: "k" },
      { attributes: { title: "Merged" } },
    );
    expect(calls[0]!.method).toBe("GET");
    expect(decodeURIComponent(calls[0]!.url)).toContain("filter[field_key]=k");
    expect(decodeURIComponent(calls[0]!.url)).toContain("page[limit]=1");
    expect(calls[1]!.method).toBe("PATCH");
    expect(calls[1]!.url).toBe("https://site/jsonapi/node/article/n1");
    expect(r.attr("title")).toBe("Merged");
  });

  it("upsert() POSTs a new resource when no match is found", async () => {
    const calls: HttpRequest[] = [];
    const http: HttpClient = {
      async send(req) {
        calls.push(req);
        if (req.method === "GET") {
          return { status: 200, headers: {}, body: '{"data":[]}' };
        }
        return {
          status: 201,
          headers: {},
          body: '{"data":{"id":"n2","type":"node--article","attributes":{"title":"Fresh"}}}',
        };
      },
    };
    const client = createJsonApiClient({
      baseUrl: "https://site",
      prefix: "/jsonapi",
      http,
      auth: passthroughAuth,
    });
    const r = await client.upsert(
      "node/article",
      { path: "field_key", value: "k" },
      { attributes: { title: "Fresh" } },
    );
    expect(calls[0]!.method).toBe("GET");
    expect(calls[1]!.method).toBe("POST");
    expect(calls[1]!.url).toBe("https://site/jsonapi/node/article");
    expect(JSON.parse(calls[1]!.body as string)).toEqual({
      data: { type: "node--article", attributes: { title: "Fresh" } },
    });
    expect(r.id).toBe("n2");
  });

  it("me() reads the uuid from meta.links.me.meta.id", async () => {
    const http = httpStub((req) => {
      expect(req.method).toBe("GET");
      expect(req.url).toBe("https://site/jsonapi/");
      return {
        status: 200,
        body: '{"meta":{"links":{"me":{"href":"https://site/jsonapi/user/user/uuid-123","meta":{"id":"uuid-123"}}}}}',
      };
    });
    const client = createJsonApiClient({
      baseUrl: "https://site",
      prefix: "/jsonapi",
      http,
      auth: passthroughAuth,
    });
    expect(await client.me()).toBe("uuid-123");
  });

  it("me() falls back to the last path segment of meta.links.me.href", async () => {
    const http = httpStub(() => ({
      status: 200,
      body: '{"meta":{"links":{"me":{"href":"https://site/jsonapi/user/user/uuid-456"}}}}',
    }));
    const client = createJsonApiClient({
      baseUrl: "https://site",
      prefix: "/jsonapi",
      http,
      auth: passthroughAuth,
    });
    expect(await client.me()).toBe("uuid-456");
  });

  it("me() throws when meta.links.me is absent", async () => {
    const http = httpStub(() => ({ status: 200, body: '{"meta":{"links":{}}}' }));
    const client = createJsonApiClient({
      baseUrl: "https://site",
      prefix: "/jsonapi",
      http,
      auth: passthroughAuth,
    });
    await expect(client.me()).rejects.toThrow();
  });
});
