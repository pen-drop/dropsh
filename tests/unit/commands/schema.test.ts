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
  return mkdtempSync(join(tmpdir(), "drupal-cli-cmd-schema-"));
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

  it("with target: emits a JSON Schema with x-drupal-cli metadata", async () => {
    const emitted: unknown[] = [];
    const warnings: string[] = [];
    const http = seqHttp([
      { status: 200, body: JSON.stringify({ properties: { data: { type: "object" } } }) },
    ]);
    await runSchema(
      { target: "node/article", operation: "create", refresh: false },
      { http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi", cwd: tempDir(), emit: (v) => emitted.push(v), warn: (m) => warnings.push(m) },
    );
    const out = emitted[0] as any;
    expect(out["x-drupal-cli-source"]).toBe("schemata");
    expect(out["x-drupal-cli-target"]).toEqual({ entity_type: "node", bundle: "article" });
    expect(out["x-drupal-cli-operation"]).toBe("create");
  });

  it("rejects invalid target with ValidationError", async () => {
    const http = seqHttp([]);
    await expect(runSchema(
      { target: "articleonly", operation: "create", refresh: false },
      { http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi", cwd: tempDir(), emit: () => {}, warn: () => {} },
    )).rejects.toBeInstanceOf(ValidationError);
  });

  it("--refresh bypasses the cache", async () => {
    const body = JSON.stringify({ properties: { data: { type: "object" } } });
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
