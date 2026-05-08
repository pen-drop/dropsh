import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSchema } from "../../../src/commands/schema.js";
import type { HttpClient } from "../../../src/core/http.js";
import type { AuthAdapter } from "../../../src/core/auth/types.js";
import { ValidationError } from "../../../src/errors.js";

const auth: AuthAdapter = { apply: async (req) => req };

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "dropsh-cmd-schema-"));
}

function rootIndexBody(): string {
  return JSON.stringify({
    links: {
      "node--article": { href: "https://ex/jsonapi/node/article", meta: { title: "Article" } },
      "taxonomy_term--tags": { href: "https://ex/jsonapi/taxonomy_term/tags" },
    },
  });
}

function seqHttp(responses: Array<{ status: number; body: string }>): HttpClient {
  let i = 0;
  return { send: vi.fn(async () => ({ headers: {}, ...responses[i++]! })) };
}

describe("runSchema", () => {
  it("no arg: emits the catalog from /jsonapi root", async () => {
    const emitted: unknown[] = [];
    const warnings: string[] = [];
    const http = seqHttp([{ status: 200, body: rootIndexBody() }]);
    await runSchema(
      { operation: "create", refresh: false },
      { http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi", cwd: tempDir(), emit: (v) => emitted.push(v), warn: (m) => warnings.push(m) },
    );
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual([
      { entity_type: "node", bundle: "article", label: "Article" },
      { entity_type: "taxonomy_term", bundle: "tags", label: "Tags" },
    ]);
  });

  it("with target: emits a JSON Schema with x-dropsh metadata", async () => {
    const emitted: unknown[] = [];
    const warnings: string[] = [];
    const http = seqHttp([
      { status: 200, body: JSON.stringify({ data: [{ type: "node--article", id: "x", attributes: { title: "A" }, relationships: {} }] }) },
    ]);
    await runSchema(
      { target: "node/article", operation: "create", refresh: false },
      { http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi", cwd: tempDir(), emit: (v) => emitted.push(v), warn: (m) => warnings.push(m) },
    );
    const out = emitted[0] as any;
    expect(out["x-dropsh-source"]).toBe("heuristic");
    expect(out["x-dropsh-target"]).toEqual({ entity_type: "node", bundle: "article" });
    expect(out["x-dropsh-operation"]).toBe("create");
  });

  it("runs operation schema hooks after create/update conversion", async () => {
    const emitted: unknown[] = [];
    const warnings: string[] = [];
    const http = seqHttp([
      {
        status: 200,
        body: JSON.stringify({
          data: [
            {
              type: "canvas_page--canvas_page",
              id: "x",
              attributes: { title: "A", components: [] },
              relationships: {},
            },
          ],
        }),
      },
    ]);
    const plugin = {
      id: "canvas",
      requiredModules: ["canvas", "jsonapi_sdc"],
      async extendSchema(_entity: string, _bundle: string, schema: unknown) {
        return schema;
      },
      async extendOperationSchema(
        _entity: string,
        _bundle: string,
        operation: "create" | "update",
        schema: unknown,
      ) {
        const out = schema as Record<string, unknown>;
        const data = (out.properties as any).data;
        return {
          ...out,
          properties: out.properties,
          "x-test-operation": operation,
          "x-test-data-required": data.required,
        };
      },
    };

    await runSchema(
      { target: "canvas_page/canvas_page", operation: "update", refresh: false },
      {
        http,
        auth,
        baseUrl: "https://ex",
        jsonapiPrefix: "/jsonapi",
        cwd: tempDir(),
        emit: (v) => emitted.push(v),
        warn: (m) => warnings.push(m),
        plugins: [plugin],
      },
    );

    const out = emitted[0] as any;
    expect(out["x-test-operation"]).toBe("update");
    expect(out["x-test-data-required"]).toEqual(["type", "id"]);
    expect(out["x-dropsh-schema-extensions"]).toEqual(["canvas"]);
  });

  it("rejects invalid target with ValidationError", async () => {
    const http = seqHttp([]);
    await expect(runSchema(
      { target: "articleonly", operation: "create", refresh: false },
      { http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi", cwd: tempDir(), emit: () => {}, warn: () => {} },
    )).rejects.toBeInstanceOf(ValidationError);
  });

  it("--refresh bypasses the cache", async () => {
    const body = JSON.stringify({ data: [{ type: "node--article", id: "x", attributes: { title: "A" }, relationships: {} }] });
    const http = seqHttp([
      { status: 200, body },
      { status: 200, body },
    ]);
    const dir = tempDir();
    const deps = { http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi", cwd: dir, emit: () => {}, warn: () => {} };
    await runSchema({ target: "node/article", operation: "create", refresh: false }, deps); // first — fetch + cache
    await runSchema({ target: "node/article", operation: "create", refresh: false }, deps); // cache hit — no HTTP
    await runSchema({ target: "node/article", operation: "create", refresh: true  }, deps); // --refresh — HTTP again
    expect((http.send as any).mock.calls.length).toBe(2);
  });
});
