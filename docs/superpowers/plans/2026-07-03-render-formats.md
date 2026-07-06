# Render Formats & Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pluggable render layer so JSON:API entities can be emitted as Markdown or a table via a global `--format <id>` flag, plus an interactive `dropsh browse` TUI — all shipped as plugins on top of the existing plugin architecture.

**Architecture:** Core gains a `Renderer` extension point on `DrupalCliPlugin` (`renderers?: Renderer[]`), selected by a global `--format` option; `json` stays the built-in default. Three new workspace packages under `plugins/` provide `md` (detail), `table` (list) renderers and an `ink`-based `browse` command (via the existing `registerCommands` hook). Renderers receive a typed `JsonApiDocument`; the TUI reuses the Markdown renderer for its detail pane.

**Tech Stack:** Node 20+, TypeScript (ESM, NodeNext), commander, vitest, biome. TUI package adds `ink` + `react` + `drupal-jsonapi-params`.

## Global Constraints

- **Language:** All source, identifiers, comments, CLI help text, error messages, JSON output, and docs are **English**.
- **Module system:** ESM only. Relative imports use the `.js` extension (NodeNext). Cross-package imports use `dropsh/plugin` and `@dropsh/plugin-*`.
- **Backward compatibility:** Default `--format=json` must reproduce today's exact stdout, including the trailing `\n` from `JSON.stringify(value)`.
- **Errors always JSON:** `Output.fail()` always writes a JSON error to stderr regardless of `--format`.
- **Exit codes:** `ConfigError` → 2, `AuthError` → 3, `ValidationError` → 4, `HttpError` → 5, else 1 (see `src/errors.ts`, unchanged).
- **Before every commit:** `npm run lint && npm run typecheck && npm test` must pass.
- **Plugin factories** return `DrupalCliPlugin`; the interface requires `id`, `requiredModules`, and `extendSchema` (renderer/TUI plugins implement a passthrough `extendSchema`).

---

## File Structure

**Core (package `dropsh`):**
- Create `src/core/jsonapi/types.ts` — `JsonApiResource`, `JsonApiDocument` domain types.
- Modify `src/core/jsonapi/client.ts` — tighten return types to the new document type.
- Create `src/core/cli/render.ts` — `Renderer`, `RenderContext` render-layer types.
- Modify `src/core/cli/output.ts` — renderer registry + format-aware `emit`.
- Modify `src/core/plugin.ts` — add `renderers?: Renderer[]`.
- Create `src/core/context.ts` — extract `CommandContext` + `createCommandContext(configPath)` (moved out of `index.ts`), reusable by plugin commands.
- Modify `src/index.ts` — delegate context creation, add global `--format`, thread `RenderContext`, per-command format guards.
- Modify `src/plugin-api.ts` — re-export the new public types/functions.

**Plugins (new workspace packages):**
- `plugins/markdown/` — `@dropsh/plugin-markdown`: `src/render-md.ts` (`renderMarkdown`), `src/index.ts` (`markdownPlugin`).
- `plugins/table/` — `@dropsh/plugin-table`: `src/columns.ts` (`pickColumns`, `formatTable`), `src/render-table.ts` (`renderTable`), `src/index.ts` (`tablePlugin`).
- `plugins/tui/` — `@dropsh/plugin-tui`: `src/views.ts` (`resolveView`, `assertTty`, option types), `src/browse-app.tsx` (`Browse` ink component), `src/index.ts` (`tuiPlugin`).

**Wiring:**
- Modify `package.json` — extend `build:plugins`.
- Modify `dropsh.config.example.js` — show the three plugins.
- Modify `README.md` — document `--format` and `browse`.

---

## Task 1: JSON:API domain types + tighten client

**Files:**
- Create: `src/core/jsonapi/types.ts`
- Modify: `src/core/jsonapi/client.ts`
- Test: `tests/unit/core/jsonapi-types.test.ts`

**Interfaces:**
- Produces: `JsonApiResource { type: string; id: string; attributes?: Record<string,unknown>; relationships?: Record<string,unknown>; links?: Record<string,unknown> }`, `JsonApiDocument { data: JsonApiResource | JsonApiResource[]; included?: JsonApiResource[]; meta?: Record<string,unknown>; links?: Record<string,unknown> }`.
- Produces: `JsonApiClient.get/post/patch(): Promise<JsonApiDocument>`, `delete(): Promise<{ ok: true }>`, `upload(): Promise<{ ok: true } | JsonApiDocument>`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/jsonapi-types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { JsonApiDocument, JsonApiResource } from "../../../src/core/jsonapi/types.js";

describe("JsonApiDocument", () => {
  it("accepts a single-resource document", () => {
    const res: JsonApiResource = { type: "node--article", id: "u1", attributes: { title: "Hi" } };
    const doc: JsonApiDocument = { data: res };
    expect(Array.isArray(doc.data)).toBe(false);
    expect((doc.data as JsonApiResource).id).toBe("u1");
  });

  it("accepts a collection document with included", () => {
    const doc: JsonApiDocument = {
      data: [{ type: "node--article", id: "u1" }],
      included: [{ type: "user--user", id: "a1" }],
    };
    expect(Array.isArray(doc.data)).toBe(true);
    expect(doc.included?.[0]?.id).toBe("a1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/core/jsonapi-types.test.ts`
Expected: FAIL — cannot find module `../../../src/core/jsonapi/types.js`.

- [ ] **Step 3: Create the types**

Create `src/core/jsonapi/types.ts`:

```ts
export interface JsonApiResource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
  links?: Record<string, unknown>;
}

export interface JsonApiDocument {
  data: JsonApiResource | JsonApiResource[];
  included?: JsonApiResource[];
  meta?: Record<string, unknown>;
  links?: Record<string, unknown>;
}
```

- [ ] **Step 4: Tighten the client return types**

In `src/core/jsonapi/client.ts`, add the import at the top:

```ts
import type { JsonApiDocument } from "./types.js";
```

Replace the `JsonApiClient` interface with:

```ts
export interface JsonApiClient {
  get(path: string, params?: DrupalJsonApiParams): Promise<JsonApiDocument>;
  post(path: string, body: unknown): Promise<JsonApiDocument>;
  patch(path: string, body: unknown): Promise<JsonApiDocument>;
  delete(path: string): Promise<{ ok: true }>;
  upload(path: string, filename: string, data: Uint8Array | Buffer): Promise<{ ok: true } | JsonApiDocument>;
}
```

Leave the internal `send()` returning `Promise<unknown>`. In the returned object, cast each method body's result:

```ts
    async get(path, params) {
      const qs = params ? `?${params.getQueryString()}` : "";
      return send("GET", joinUrl(opts.baseUrl, opts.prefix, path) + qs) as Promise<JsonApiDocument>;
    },
    async post(path, body) {
      return send("POST", joinUrl(opts.baseUrl, opts.prefix, path), JSON.stringify(body)) as Promise<JsonApiDocument>;
    },
    async patch(path, body) {
      return send("PATCH", joinUrl(opts.baseUrl, opts.prefix, path), JSON.stringify(body)) as Promise<JsonApiDocument>;
    },
    async delete(path) {
      return send("DELETE", joinUrl(opts.baseUrl, opts.prefix, path)) as Promise<{ ok: true }>;
    },
    async upload(path, filename, data) {
      return send("POST", joinUrl(opts.baseUrl, opts.prefix, path), data, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `file; filename="${filename}"`,
      }) as Promise<{ ok: true } | JsonApiDocument>;
    },
```

- [ ] **Step 5: Run test + full typecheck**

Run: `npx vitest run tests/unit/core/jsonapi-types.test.ts && npm run typecheck`
Expected: test PASS; typecheck PASS (existing command/emit code still compiles — `emit` accepts `unknown`, so a `JsonApiDocument` argument is assignable).

- [ ] **Step 6: Commit**

```bash
git add src/core/jsonapi/types.ts src/core/jsonapi/client.ts tests/unit/core/jsonapi-types.test.ts
git commit -m "feat: add JSON:API document types and tighten client returns"
```

---

## Task 2: Renderer contract + format-aware output

**Files:**
- Create: `src/core/cli/render.ts`
- Modify: `src/core/cli/output.ts`
- Modify: `src/core/plugin.ts`
- Test: `tests/unit/core/output.test.ts`

**Interfaces:**
- Consumes: `JsonApiDocument` (Task 1).
- Produces: `RenderContext { command: "read"|"search"|"create"|"update"; target?: string; entityType?: string; bundle?: string }`, `Renderer { readonly id: string; render(doc: JsonApiDocument, ctx: RenderContext): string }`.
- Produces: `Output { emit(value: unknown, ctx?: RenderContext): void; fail(err: unknown): void; hasFormat(id: string): boolean }`, `createOutput(opts: OutputOptions)` where `OutputOptions { stdout; stderr; renderers?: Renderer[]; getFormat?: () => string }`.
- Produces: `DrupalCliPlugin.renderers?: Renderer[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/output.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createOutput } from "../../../src/core/cli/output.js";
import type { Renderer } from "../../../src/core/cli/render.js";
import { ConfigError } from "../../../src/errors.js";

const mdRenderer: Renderer = {
  id: "md",
  render: (doc) => `# ${(Array.isArray(doc.data) ? doc.data[0] : doc.data)?.id ?? ""}`,
};

function collect() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, push: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) } };
}

describe("createOutput", () => {
  it("defaults to JSON with a trailing newline (backward compatible)", () => {
    const c = collect();
    const o = createOutput({ ...c.push });
    o.emit({ data: { type: "node--article", id: "u1" } });
    expect(c.out.join("")).toBe(`${JSON.stringify({ data: { type: "node--article", id: "u1" } })}\n`);
  });

  it("routes a document through the selected renderer", () => {
    const c = collect();
    const o = createOutput({ ...c.push, renderers: [mdRenderer], getFormat: () => "md" });
    o.emit({ data: { type: "node--article", id: "u1" } }, { command: "read" });
    expect(c.out.join("")).toBe("# u1\n");
  });

  it("falls back to JSON for non-document values even under a renderer format", () => {
    const c = collect();
    const o = createOutput({ ...c.push, renderers: [mdRenderer], getFormat: () => "md" });
    o.emit({ dry_run: true, method: "POST", path: "node/article" }, { command: "create" });
    expect(c.out.join("")).toBe(`${JSON.stringify({ dry_run: true, method: "POST", path: "node/article" })}\n`);
  });

  it("hasFormat knows json and registered renderer ids", () => {
    const o = createOutput({ ...collect().push, renderers: [mdRenderer] });
    expect(o.hasFormat("json")).toBe(true);
    expect(o.hasFormat("md")).toBe(true);
    expect(o.hasFormat("table")).toBe(false);
  });

  it("throws ConfigError on duplicate renderer ids", () => {
    expect(() => createOutput({ ...collect().push, renderers: [mdRenderer, mdRenderer] }))
      .toThrow(ConfigError);
  });

  it("fail() always emits JSON to stderr", () => {
    const c = collect();
    const o = createOutput({ ...c.push, renderers: [mdRenderer], getFormat: () => "md" });
    o.fail(new ConfigError("boom"));
    expect(JSON.parse(c.err.join("")).error.code).toBe("E_CONFIG");
    expect(c.out.join("")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/core/output.test.ts`
Expected: FAIL — cannot find module `render.js`; `getFormat`/`renderers`/`hasFormat` not supported.

- [ ] **Step 3: Create the render types**

Create `src/core/cli/render.ts`:

```ts
import type { JsonApiDocument } from "../jsonapi/types.js";

export interface RenderContext {
  command: "read" | "search" | "create" | "update";
  target?: string;
  entityType?: string;
  bundle?: string;
}

export interface Renderer {
  readonly id: string;
  render(doc: JsonApiDocument, ctx: RenderContext): string;
}
```

- [ ] **Step 4: Rewrite the output module**

Replace the entire contents of `src/core/cli/output.ts` with:

```ts
import { CliError, ConfigError } from "../../errors.js";
import type { JsonApiDocument } from "../jsonapi/types.js";
import type { Renderer, RenderContext } from "./render.js";

export interface Output {
  emit(value: unknown, ctx?: RenderContext): void;
  fail(err: unknown): void;
  hasFormat(id: string): boolean;
}

export interface OutputOptions {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  renderers?: Renderer[];
  getFormat?: () => string;
}

function isJsonApiDocument(v: unknown): v is JsonApiDocument {
  return !!v && typeof v === "object" && "data" in (v as Record<string, unknown>);
}

export function createOutput(opts: OutputOptions): Output {
  const registry = new Map<string, Renderer>();
  for (const r of opts.renderers ?? []) {
    if (registry.has(r.id)) throw new ConfigError(`Duplicate renderer id: ${r.id}`);
    registry.set(r.id, r);
  }
  const getFormat = opts.getFormat ?? (() => "json");

  return {
    emit(value, ctx) {
      const fmt = getFormat();
      if (fmt === "json" || !isJsonApiDocument(value)) {
        opts.stdout(`${JSON.stringify(value)}\n`);
        return;
      }
      const renderer = registry.get(fmt);
      if (!renderer) {
        throw new ConfigError(`Unknown format: ${fmt}`, {
          available: ["json", ...registry.keys()],
        });
      }
      const text = renderer.render(value, ctx ?? { command: "read" });
      opts.stdout(text.endsWith("\n") ? text : `${text}\n`);
    },
    fail(err) {
      const payload =
        err instanceof CliError
          ? { error: { code: err.code, message: err.message, details: err.details } }
          : {
              error: {
                code: "E_UNKNOWN",
                message: (err as Error).message ?? String(err),
                details: {},
              },
            };
      opts.stderr(`${JSON.stringify(payload)}\n`);
    },
    hasFormat(id) {
      return id === "json" || registry.has(id);
    },
  };
}
```

- [ ] **Step 5: Add `renderers` to the plugin interface**

In `src/core/plugin.ts`, add the import and the optional field. After the existing imports add:

```ts
import type { Renderer } from "./cli/render.js";
```

Inside `interface DrupalCliPlugin`, add as the last member:

```ts
  renderers?: Renderer[];
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/unit/core/output.test.ts && npm run typecheck`
Expected: all output tests PASS; typecheck PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/cli/render.ts src/core/cli/output.ts src/core/plugin.ts tests/unit/core/output.test.ts
git commit -m "feat: add renderer contract and format-aware output"
```

---

## Task 3: Extract context builder + plugin-api re-exports

**Files:**
- Create: `src/core/context.ts`
- Modify: `src/index.ts` (remove local `CommandContext` + `defaultContext`, import from context)
- Modify: `src/plugin-api.ts`
- Test: `tests/unit/core/context.test.ts`

**Interfaces:**
- Produces: `CommandContext { client: JsonApiClient; http: HttpClient; auth: AuthAdapter; baseUrl: string; jsonapiPrefix: string; cwd: string; plugins: DrupalCliPlugin[] }`, `createCommandContext(configPath: string): Promise<CommandContext>`.
- Produces (from `dropsh/plugin`): `createCommandContext`, `CommandContext`, `createJsonApiClient`, `JsonApiClient`, `JsonApiDocument`, `JsonApiResource`, `Renderer`, `RenderContext`.
- Consumes: `loadConfig` (existing), `createHttpClient` (existing), `createJsonApiClient` (existing).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/context.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createCommandContext } from "../../../src/core/context.js";
import * as configMod from "../../../src/core/config.js";
import type { AuthAdapter } from "../../../src/core/auth/types.js";
import { ConfigError } from "../../../src/errors.js";

const adapter: AuthAdapter = { apply: async (req) => req };

describe("createCommandContext", () => {
  it("builds a client from config using the auth plugin", async () => {
    vi.spyOn(configMod, "loadConfig").mockResolvedValue({
      site: { base_url: "https://x.example", jsonapi_prefix: "/jsonapi" },
      defaults: { dry_run: false, timeout_ms: 30000 },
      plugins: [
        { id: "auth", requiredModules: [], createAuthAdapter: () => adapter, async extendSchema(_e, _b, s) { return s; } },
      ],
    });
    const ctx = await createCommandContext("dropsh.config.js");
    expect(ctx.baseUrl).toBe("https://x.example");
    expect(ctx.jsonapiPrefix).toBe("/jsonapi");
    expect(typeof ctx.client.get).toBe("function");
  });

  it("throws ConfigError when no auth plugin is configured", async () => {
    vi.spyOn(configMod, "loadConfig").mockResolvedValue({
      site: { base_url: "https://x.example", jsonapi_prefix: "/jsonapi" },
      defaults: { dry_run: false, timeout_ms: 30000 },
      plugins: [],
    });
    await expect(createCommandContext("dropsh.config.js")).rejects.toBeInstanceOf(ConfigError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/core/context.test.ts`
Expected: FAIL — cannot find module `../../../src/core/context.js`.

- [ ] **Step 3: Create the context module**

Create `src/core/context.ts` (this is the exact logic currently inline in `src/index.ts`):

```ts
import type { AuthAdapter } from "./auth/types.js";
import { loadConfig } from "./config.js";
import type { HttpClient } from "./http.js";
import { createHttpClient } from "./http.js";
import { createJsonApiClient, type JsonApiClient } from "./jsonapi/client.js";
import type { DrupalCliPlugin } from "./plugin.js";
import { ConfigError } from "../errors.js";

export interface CommandContext {
  client: JsonApiClient;
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  jsonapiPrefix: string;
  cwd: string;
  plugins: DrupalCliPlugin[];
}

export async function createCommandContext(configPath: string): Promise<CommandContext> {
  const cfg = await loadConfig(configPath);
  const http = createHttpClient({ timeoutMs: cfg.defaults.timeout_ms });
  const authPlugin = cfg.plugins.find((p) => p.createAuthAdapter);
  if (!authPlugin?.createAuthAdapter) {
    throw new ConfigError(
      "No auth plugin configured. Add basicAuthPlugin() or oauth2Plugin() to config.plugins.",
    );
  }
  const auth = authPlugin.createAuthAdapter();
  const client = createJsonApiClient({
    baseUrl: cfg.site.base_url,
    prefix: cfg.site.jsonapi_prefix,
    http,
    auth,
  });
  return {
    client,
    http,
    auth,
    baseUrl: cfg.site.base_url,
    jsonapiPrefix: cfg.site.jsonapi_prefix,
    cwd: process.cwd(),
    plugins: cfg.plugins,
  };
}
```

- [ ] **Step 4: Update `src/index.ts` to use the extracted module**

Remove the local `CommandContext` interface (lines defining `export interface CommandContext { … }`) and the entire `async function defaultContext(configPath) { … }`. Remove now-unused imports (`loadConfig`, `createHttpClient`, `createJsonApiClient`, `AuthAdapter`, `HttpClient` — keep `JsonApiClient` if still referenced by command deps typing; it is). Add near the other imports:

```ts
import { type CommandContext, createCommandContext } from "./core/context.js";
```

Re-export the type for existing importers (`tests/unit/index.test.ts` imports `CommandContext` from `../../src/index.js`):

```ts
export type { CommandContext } from "./core/context.js";
```

Update the `contextFactory` default in `buildProgram`:

```ts
  const contextFactory =
    opts.contextFactory ??
    (() => createCommandContext(resolveConfigPath(program.opts().config as string | undefined)));
```

Also remove the now-stale `import { ConfigError } from "./errors.js"` only if `ConfigError` is otherwise unused; Task 4 re-introduces a use, so keep `ConfigError` imported.

- [ ] **Step 5: Add the public re-exports**

Replace the contents of `src/plugin-api.ts` with:

```ts
export type { BasicAuthConfig } from "./core/auth/basic.js";
export { basicAuthPlugin } from "./core/auth/basic.js";
export type { AuthAdapter } from "./core/auth/types.js";
export type { Config, SiteConfig } from "./core/config.js";
export { loadConfig } from "./core/config.js";
export type { CommandContext } from "./core/context.js";
export { createCommandContext } from "./core/context.js";
export type { HttpClient, HttpRequest } from "./core/http.js";
export { createHttpClient } from "./core/http.js";
export type { JsonApiClient } from "./core/jsonapi/client.js";
export { createJsonApiClient } from "./core/jsonapi/client.js";
export type { JsonApiDocument, JsonApiResource } from "./core/jsonapi/types.js";
export type { DrupalCliPlugin, PluginContext } from "./core/plugin.js";
export type { Renderer, RenderContext } from "./core/cli/render.js";
export { AuthError, ConfigError, HttpError } from "./errors.js";
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/unit/core/context.test.ts tests/unit/index.test.ts && npm run typecheck`
Expected: context tests PASS; existing `index.test.ts` still PASS; typecheck PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/context.ts src/index.ts src/plugin-api.ts tests/unit/core/context.test.ts
git commit -m "refactor: extract createCommandContext and export render/client API for plugins"
```

---

## Task 4: Wire `--format` option, context threading, and guards

**Files:**
- Modify: `src/index.ts`
- Test: `tests/unit/index-format.test.ts`

**Interfaces:**
- Consumes: `Output` (`emit(value, ctx?)`, `hasFormat`), `RenderContext`, `createOutput` renderer registry.
- Behaviour: global `--format <id>` (default `json`); `read`/`search`/`create`/`update` accept any registered format and pass a `RenderContext` to `emit`; `delete`/`upload-file`/`schema` reject any non-`json` format with `ConfigError`; unknown formats reject before any HTTP.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/index-format.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildProgram, type CommandContext } from "../../src/index.js";
import type { JsonApiClient } from "../../src/core/jsonapi/client.js";
import type { DrupalCliPlugin } from "../../src/core/plugin.js";

function fakeClient(): JsonApiClient {
  return {
    get: vi.fn(async () => ({ data: { type: "node--article", id: "u1", attributes: { title: "Hi" } } })),
    post: vi.fn(async () => ({ data: { type: "node--article", id: "u2" } })),
    patch: vi.fn(async () => ({ data: { type: "node--article", id: "u1" } })),
    delete: vi.fn(async () => ({ ok: true as const })),
    upload: vi.fn(async () => ({ data: { type: "file--file", id: "f1" } })),
  };
}

const mdPlugin: DrupalCliPlugin = {
  id: "md-test",
  requiredModules: [],
  async extendSchema(_e, _b, s) { return s; },
  renderers: [{ id: "md", render: (doc) => `# ${(Array.isArray(doc.data) ? doc.data[0] : doc.data)?.id ?? ""}` }],
};

function harness(plugins: DrupalCliPlugin[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const codes: number[] = [];
  const program = buildProgram({
    plugins,
    contextFactory: async () => ({ client: fakeClient(), plugins } as unknown as CommandContext),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    setExitCode: (c) => codes.push(c),
  });
  return { program, out, err, codes };
}

describe("--format", () => {
  it("read defaults to JSON", async () => {
    const h = harness();
    await h.program.parseAsync(["node", "dropsh", "read", "node/article/abcdef01-abcd-abcd-abcd-abcdef012345"]);
    expect(JSON.parse(h.out.join(""))).toEqual({ data: { type: "node--article", id: "u1", attributes: { title: "Hi" } } });
  });

  it("read with --format md uses the renderer", async () => {
    const h = harness([mdPlugin]);
    await h.program.parseAsync(["node", "dropsh", "--format", "md", "read", "node/article/abcdef01-abcd-abcd-abcd-abcdef012345"]);
    expect(h.out.join("")).toBe("# u1\n");
  });

  it("unknown format exits 2 before HTTP", async () => {
    const h = harness();
    const c = h.program;
    await c.parseAsync(["node", "dropsh", "--format", "md", "read", "node/article/abcdef01-abcd-abcd-abcd-abcdef012345"]);
    expect(JSON.parse(h.err.join("")).error.code).toBe("E_CONFIG");
    expect(h.codes).toContain(2);
  });

  it("format on a non-entity command (schema) exits 2", async () => {
    const h = harness([mdPlugin]);
    await h.program.parseAsync(["node", "dropsh", "--format", "md", "schema"]);
    expect(JSON.parse(h.err.join("")).error.code).toBe("E_CONFIG");
    expect(h.codes).toContain(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/index-format.test.ts`
Expected: FAIL — `--format` unknown option / renderer not applied / guards missing.

- [ ] **Step 3: Declare the global option and build the renderer-aware output**

In `src/index.ts`, add `--format` to the program definition (after the existing `--config` option):

```ts
    .option("--format <id>", "output format: json (default) or a renderer id", "json");
```

Replace the `const output = createOutput({ stdout, stderr });` line with:

```ts
  const renderers = (opts.plugins ?? []).flatMap((p) => p.renderers ?? []);
  const output = createOutput({
    stdout,
    stderr,
    renderers,
    getFormat: () => (program.opts().format as string | undefined) ?? "json",
  });
```

Update the `createOutput` import to include what is needed (it already imports `createOutput`). Ensure `RenderContext` is imported:

```ts
import type { RenderContext } from "./core/cli/render.js";
```

- [ ] **Step 4: Add format guards and a pre-HTTP check to `run`**

Change the `run` helper to accept an optional synchronous pre-check that runs **before** `contextFactory` (so validation happens before any HTTP/auth):

```ts
  async function run(
    fn: (ctx: CommandContext) => Promise<void>,
    precheck?: () => void,
  ): Promise<void> {
    try {
      precheck?.();
      const ctx = await contextFactory();
      await fn(ctx);
    } catch (err) {
      output.fail(err);
      setExitCode(exitCodeFor(err));
    }
  }
```

Add two guard helpers just above the first `program.command(...)` call:

```ts
  function currentFormat(): string {
    return (program.opts().format as string | undefined) ?? "json";
  }
  function assertRenderable(): void {
    const f = currentFormat();
    if (!output.hasFormat(f)) {
      throw new ConfigError(`Unknown format '${f}'. Available: ${["json", ...renderers.map((r) => r.id)].join(", ")}`);
    }
  }
  function assertJsonOnly(command: string): void {
    const f = currentFormat();
    if (f !== "json") {
      throw new ConfigError(`format '${f}' not applicable to command '${command}'`);
    }
  }
```

- [ ] **Step 5: Thread `RenderContext` into the four entity commands and add guards**

Rewrite the `read` action:

```ts
  program
    .command("read <target>")
    .description("Read entity_type/bundle/uuid")
    .action((target: string) => {
      const [entityType, bundle] = target.split("/") as [string?, string?];
      const rctx: RenderContext = { command: "read", target };
      if (entityType !== undefined) rctx.entityType = entityType;
      if (bundle !== undefined) rctx.bundle = bundle;
      run(
        (ctx) => runRead({ target }, { client: ctx.client, emit: (v) => output.emit(v, rctx) }),
        assertRenderable,
      );
    });
```

In the `search` action, build the render context and guard:

```ts
    .action((entityType: string, o: { bundle?: string; filter: string[]; limit: number }) => {
      // biome-ignore lint/suspicious/noExplicitAny: optional bundle added conditionally
      const args = { entityType, filters: o.filter, limit: o.limit } as any;
      if (o.bundle !== undefined) args.bundle = o.bundle;
      const rctx: RenderContext = { command: "search", entityType };
      if (o.bundle !== undefined) rctx.bundle = o.bundle;
      run(
        (ctx) => runSearch(args, { client: ctx.client, emit: (v) => output.emit(v, rctx) }),
        assertRenderable,
      );
    });
```

In the `create` action, replace the inner `run(async (ctx) => { … })` call so `emit` carries context and the pre-check runs. Change the `deps` object's `emit` and add the precheck argument:

```ts
        run(async (ctx) => {
          const rctx: RenderContext = { command: "create", entityType, bundle: o.bundle };
          const deps: {
            client: JsonApiClient;
            emit: (v: unknown) => void;
            validate?: (payload: unknown, target: string) => void | Promise<void>;
          } = { client: ctx.client, emit: (v) => output.emit(v, rctx) };
          if (!args.noValidate) {
            deps.validate = async (payload: unknown, target: string) => {
              const schema = await loadOrFetchSchema(ctx, target, "create");
              validatePayload(schema, payload, target);
            };
          }
          await runCreate(args, deps);
        }, assertRenderable);
```

In the `update` action, do the same — build `rctx` from the parsed target and pass `assertRenderable`:

```ts
      run(async (ctx) => {
        const [entityType, bundle] = target.split("/") as [string?, string?];
        const rctx: RenderContext = { command: "update", target };
        if (entityType !== undefined) rctx.entityType = entityType;
        if (bundle !== undefined) rctx.bundle = bundle;
        const deps: {
          client: JsonApiClient;
          emit: (v: unknown) => void;
          validate?: (payload: unknown, target: string) => void | Promise<void>;
        } = { client: ctx.client, emit: (v) => output.emit(v, rctx) };
        if (!args.noValidate) {
          deps.validate = async (payload: unknown, t: string) => {
            const schema = await loadOrFetchSchema(ctx, t, "update");
            validatePayload(schema, payload, t);
          };
        }
        await runUpdate(args, deps);
      }, assertRenderable);
```

- [ ] **Step 6: Add the json-only guard to `delete`, `upload-file`, and `schema`**

For each of these three actions, add the precheck as the second argument to `run(...)`:

- `delete`: `run((ctx) => runDelete(args, { client: ctx.client, emit: output.emit }), () => assertJsonOnly("delete"));`
- `upload-file`: `run((ctx) => runUploadFile(args, { client: ctx.client, emit: output.emit }), () => assertJsonOnly("upload-file"));`
- `schema`: wrap the existing `run((ctx) => runSchema(...))` call, adding `, () => assertJsonOnly("schema")` as the second argument to `run`.

- [ ] **Step 7: Run tests + full suite + typecheck + lint**

Run: `npx vitest run tests/unit/index-format.test.ts tests/unit/index.test.ts && npm run typecheck && npm run lint`
Expected: all PASS. (`index.test.ts` remains green because default format is `json`.)

- [ ] **Step 8: Commit**

```bash
git add src/index.ts tests/unit/index-format.test.ts
git commit -m "feat: add --format flag, render-context threading, and per-command format guards"
```

---

## Task 5: `@dropsh/plugin-markdown`

**Files:**
- Create: `plugins/markdown/package.json`
- Create: `plugins/markdown/tsconfig.json`
- Create: `plugins/markdown/vitest.config.ts`
- Create: `plugins/markdown/src/render-md.ts`
- Create: `plugins/markdown/src/index.ts`
- Test: `plugins/markdown/tests/unit/render-md.test.ts`

**Interfaces:**
- Consumes: `JsonApiDocument`, `RenderContext`, `DrupalCliPlugin` from `dropsh/plugin`.
- Produces: `renderMarkdown(doc: JsonApiDocument, ctx: RenderContext): string`, `markdownPlugin(): DrupalCliPlugin` (renderer id `"md"`).

- [ ] **Step 1: Scaffold the package**

Create `plugins/markdown/package.json` (mirror `plugins/schemata/package.json`):

```json
{
  "name": "@dropsh/plugin-markdown",
  "version": "0.0.1-alpha.0",
  "type": "module",
  "main": "./dist/plugins/markdown/src/index.js",
  "exports": {
    ".": "./dist/plugins/markdown/src/index.js",
    "./render": "./dist/plugins/markdown/src/render-md.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "dropsh": "*"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

Create `plugins/markdown/tsconfig.json` — copy `plugins/schemata/tsconfig.json` verbatim (same compiler options, same relative `extends`/paths). Create `plugins/markdown/vitest.config.ts` — copy `plugins/schemata/vitest.config.ts` verbatim.

- [ ] **Step 2: Write the failing test**

Create `plugins/markdown/tests/unit/render-md.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/render-md.js";

const ctx = { command: "read" as const };

describe("renderMarkdown", () => {
  it("renders a single resource as frontmatter + body", () => {
    const out = renderMarkdown(
      { data: { type: "node--article", id: "u1", attributes: { title: "Hello", status: true, body: { value: "The text." } } } },
      ctx,
    );
    expect(out).toContain("type: node--article");
    expect(out).toContain("id: u1");
    expect(out).toContain("title: Hello");
    expect(out).toContain("status: true");
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain("\n---\n\nThe text.");
  });

  it("uses the longest string field as body when there is no body field", () => {
    const out = renderMarkdown(
      { data: { type: "node--page", id: "p1", attributes: { title: "T", summary: "short", teaser: "a much longer piece of text here" } } },
      ctx,
    );
    expect(out.trimEnd().endsWith("a much longer piece of text here")).toBe(true);
  });

  it("lists relationships as type/id arrays", () => {
    const out = renderMarkdown(
      { data: { type: "node--article", id: "u1", attributes: {}, relationships: { uid: { data: { type: "user--user", id: "a1" } } } } },
      ctx,
    );
    expect(out).toContain("uid: [user--user/a1]");
  });

  it("joins a collection with a separator", () => {
    const out = renderMarkdown(
      { data: [{ type: "node--article", id: "u1", attributes: { title: "A" } }, { type: "node--article", id: "u2", attributes: { title: "B" } }] },
      { command: "search" },
    );
    expect(out).toContain("id: u1");
    expect(out).toContain("id: u2");
    expect(out).toContain("\n\n---\n\n");
  });

  it("renders an empty collection as a placeholder", () => {
    expect(renderMarkdown({ data: [] }, { command: "search" })).toBe("_(no results)_");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --root plugins/markdown`
Expected: FAIL — cannot find module `../../src/render-md.js`.

- [ ] **Step 4: Implement the renderer**

Create `plugins/markdown/src/render-md.ts`:

```ts
import type { JsonApiDocument, JsonApiResource, RenderContext } from "dropsh/plugin";

type Scalar = string | number | boolean;

function isScalar(v: unknown): v is Scalar {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function yamlScalar(v: Scalar): string {
  if (typeof v === "string") {
    return v === "" || v.trim() !== v || /[:#\n"'[\]{}]/.test(v) ? JSON.stringify(v) : v;
  }
  return String(v);
}

function isRef(x: unknown): x is { type: string; id: string } {
  return (
    !!x &&
    typeof x === "object" &&
    typeof (x as { type?: unknown }).type === "string" &&
    typeof (x as { id?: unknown }).id === "string"
  );
}

function relIds(rel: unknown): string[] {
  if (!rel || typeof rel !== "object") return [];
  const data = (rel as { data?: unknown }).data;
  if (Array.isArray(data)) return data.filter(isRef).map((r) => `${r.type}/${r.id}`);
  if (isRef(data)) return [`${data.type}/${data.id}`];
  return [];
}

function extractBody(attrs: Record<string, unknown>): string {
  const b = attrs.body;
  if (b && typeof b === "object") {
    const o = b as Record<string, unknown>;
    if (typeof o.processed === "string") return o.processed;
    if (typeof o.value === "string") return o.value;
  }
  if (typeof b === "string") return b;
  let best = "";
  for (const [k, v] of Object.entries(attrs)) {
    if (k !== "body" && typeof v === "string" && v.length > best.length) best = v;
  }
  return best;
}

function renderResource(res: JsonApiResource): string {
  const attrs = res.attributes ?? {};
  const fm: string[] = [`type: ${res.type}`, `id: ${res.id}`];
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "body") continue;
    if (isScalar(v)) fm.push(`${k}: ${yamlScalar(v)}`);
  }
  for (const [k, v] of Object.entries(res.relationships ?? {})) {
    const ids = relIds(v);
    if (ids.length) fm.push(`${k}: [${ids.join(", ")}]`);
  }
  const body = extractBody(attrs);
  return `---\n${fm.join("\n")}\n---\n\n${body}`.trimEnd();
}

export function renderMarkdown(doc: JsonApiDocument, _ctx: RenderContext): string {
  const data = doc.data;
  if (Array.isArray(data)) {
    if (data.length === 0) return "_(no results)_";
    return data.map(renderResource).join("\n\n---\n\n");
  }
  return renderResource(data);
}
```

- [ ] **Step 5: Implement the plugin factory**

Create `plugins/markdown/src/index.ts`:

```ts
import type { DrupalCliPlugin } from "dropsh/plugin";
import { renderMarkdown } from "./render-md.js";

export { renderMarkdown };

export function markdownPlugin(): DrupalCliPlugin {
  return {
    id: "markdown",
    requiredModules: [],
    async extendSchema(_entityType, _bundle, schema) {
      return schema;
    },
    renderers: [{ id: "md", render: renderMarkdown }],
  };
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm --prefix . run build && npx vitest run --root plugins/markdown && npm --prefix plugins/markdown run typecheck`
Expected: `renderMarkdown` tests PASS; typecheck PASS. (Root `build` first so `dropsh/plugin` type declarations resolve for the plugin's typecheck.)

- [ ] **Step 7: Commit**

```bash
git add plugins/markdown
git commit -m "feat: add @dropsh/plugin-markdown renderer"
```

---

## Task 6: `@dropsh/plugin-table`

**Files:**
- Create: `plugins/table/package.json`, `plugins/table/tsconfig.json`, `plugins/table/vitest.config.ts`
- Create: `plugins/table/src/columns.ts`
- Create: `plugins/table/src/render-table.ts`
- Create: `plugins/table/src/index.ts`
- Test: `plugins/table/tests/unit/render-table.test.ts`

**Interfaces:**
- Consumes: `JsonApiDocument`, `JsonApiResource`, `RenderContext`, `DrupalCliPlugin` from `dropsh/plugin`.
- Produces: `pickColumns(res: JsonApiResource): string[]`, `formatTable(headers: string[], rows: string[][]): string`, `renderTable(doc: JsonApiDocument, ctx: RenderContext): string`, `tablePlugin(): DrupalCliPlugin` (renderer id `"table"`).

- [ ] **Step 1: Scaffold the package**

Create `plugins/table/package.json` (same shape as Task 5, with `name: "@dropsh/plugin-table"`, `main`/`exports` pointing at `./dist/plugins/table/src/index.js`, and an extra export `"./render": "./dist/plugins/table/src/render-table.js"`). Copy `tsconfig.json` and `vitest.config.ts` verbatim from `plugins/schemata`.

- [ ] **Step 2: Write the failing test**

Create `plugins/table/tests/unit/render-table.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pickColumns, renderTable } from "../../src/render-table.js";

const ctx = { command: "search" as const };

describe("pickColumns", () => {
  it("puts id first and prefers title/status", () => {
    const cols = pickColumns({ type: "node--article", id: "u1", attributes: { body: "x", status: true, title: "T" } });
    expect(cols[0]).toBe("id");
    expect(cols).toContain("title");
    expect(cols).toContain("status");
  });
});

describe("renderTable", () => {
  it("renders a collection as an aligned box table", () => {
    const out = renderTable(
      { data: [
        { type: "node--article", id: "u1", attributes: { title: "Alpha", status: true } },
        { type: "node--article", id: "u2", attributes: { title: "Beta", status: false } },
      ] },
      ctx,
    );
    const lines = out.split("\n");
    expect(lines[0].startsWith("┌")).toBe(true);
    expect(out).toContain("u1");
    expect(out).toContain("Alpha");
    // every rendered line is the same visual width
    expect(new Set(lines.map((l) => [...l].length)).size).toBe(1);
  });

  it("renders an empty collection as (0 rows)", () => {
    expect(renderTable({ data: [] }, ctx)).toBe("(0 rows)");
  });

  it("renders a single resource as a key/value table", () => {
    const out = renderTable({ data: { type: "node--article", id: "u1", attributes: { title: "Solo" } } }, { command: "read" });
    expect(out).toContain("field");
    expect(out).toContain("value");
    expect(out).toContain("title");
    expect(out).toContain("Solo");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --root plugins/table`
Expected: FAIL — cannot find module `../../src/render-table.js`.

- [ ] **Step 4: Implement the column helpers**

Create `plugins/table/src/columns.ts`:

```ts
import type { JsonApiResource } from "dropsh/plugin";

const PREFERRED = ["title", "name", "label", "status"];
const MAX_CELL = 40;
const MAX_COLS = 5;

function isScalar(v: unknown): boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

export function pickColumns(res: JsonApiResource): string[] {
  const attrs = res.attributes ?? {};
  const scalars = Object.entries(attrs).filter(([, v]) => isScalar(v)).map(([k]) => k);
  const preferred = PREFERRED.filter((k) => scalars.includes(k));
  const rest = scalars.filter((k) => !preferred.includes(k));
  return ["id", ...preferred, ...rest].slice(0, MAX_COLS);
}

export function cell(v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v);
  return s.length > MAX_CELL ? `${s.slice(0, MAX_CELL - 1)}…` : s;
}

export function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length), 0),
  );
  const bar = (l: string, m: string, r: string) =>
    `${l}${widths.map((w) => "─".repeat(w + 2)).join(m)}${r}`;
  const line = (cells: string[]) =>
    `│ ${cells.map((c, i) => (c ?? "").padEnd(widths[i] ?? 0)).join(" │ ")} │`;
  return [
    bar("┌", "┬", "┐"),
    line(headers),
    bar("├", "┼", "┤"),
    ...rows.map(line),
    bar("└", "┴", "┘"),
  ].join("\n");
}
```

- [ ] **Step 5: Implement the renderer**

Create `plugins/table/src/render-table.ts`:

```ts
import type { JsonApiDocument, RenderContext } from "dropsh/plugin";
import { cell, formatTable, pickColumns } from "./columns.js";

export { pickColumns, formatTable };

function isScalar(v: unknown): boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

export function renderTable(doc: JsonApiDocument, _ctx: RenderContext): string {
  const data = doc.data;
  if (Array.isArray(data)) {
    if (data.length === 0) return "(0 rows)";
    const first = data[0];
    if (!first) return "(0 rows)";
    const cols = pickColumns(first);
    const rows = data.map((res) =>
      cols.map((c) => cell(c === "id" ? res.id : (res.attributes ?? {})[c])),
    );
    return formatTable(cols, rows);
  }
  const rows: string[][] = [
    ["type", data.type],
    ["id", data.id],
  ];
  for (const [k, v] of Object.entries(data.attributes ?? {})) {
    if (isScalar(v)) rows.push([k, cell(v)]);
  }
  return formatTable(["field", "value"], rows);
}
```

- [ ] **Step 6: Implement the plugin factory**

Create `plugins/table/src/index.ts`:

```ts
import type { DrupalCliPlugin } from "dropsh/plugin";
import { renderTable } from "./render-table.js";

export { renderTable };

export function tablePlugin(): DrupalCliPlugin {
  return {
    id: "table",
    requiredModules: [],
    async extendSchema(_entityType, _bundle, schema) {
      return schema;
    },
    renderers: [{ id: "table", render: renderTable }],
  };
}
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm run build && npx vitest run --root plugins/table && npm --prefix plugins/table run typecheck`
Expected: table tests PASS; typecheck PASS.

- [ ] **Step 8: Commit**

```bash
git add plugins/table
git commit -m "feat: add @dropsh/plugin-table renderer"
```

---

## Task 7: `@dropsh/plugin-tui`

**Files:**
- Create: `plugins/tui/package.json`, `plugins/tui/tsconfig.json`, `plugins/tui/vitest.config.ts`
- Create: `plugins/tui/src/views.ts`
- Create: `plugins/tui/src/browse-app.tsx`
- Create: `plugins/tui/src/index.ts`
- Test: `plugins/tui/tests/unit/views.test.ts`, `plugins/tui/tests/unit/browse-app.test.tsx`

**Interfaces:**
- Consumes: `createCommandContext`, `CommandContext`, `JsonApiClient`, `JsonApiDocument`, `JsonApiResource`, `DrupalCliPlugin` from `dropsh/plugin`; `renderMarkdown` from `@dropsh/plugin-markdown/render`; `ink` (`render`, `Box`, `Text`, `useInput`), `react`, `drupal-jsonapi-params`.
- Produces: `TuiViewConfig`, `TuiOptions`, `resolveView(opts: TuiOptions, entityType: string, bundle?: string): ResolvedView`, `assertTty(isTty: boolean): void`, `Browse` React component, `tuiPlugin(opts?: TuiOptions): DrupalCliPlugin` (registers `browse <entity_type>`).

- [ ] **Step 1: Scaffold the package**

Create `plugins/tui/package.json`:

```json
{
  "name": "@dropsh/plugin-tui",
  "version": "0.0.1-alpha.0",
  "type": "module",
  "main": "./dist/plugins/tui/src/index.js",
  "exports": {
    ".": "./dist/plugins/tui/src/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "dropsh": "*"
  },
  "dependencies": {
    "@dropsh/plugin-markdown": "*",
    "drupal-jsonapi-params": "^3.0.1",
    "ink": "^5.0.0",
    "react": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "ink-testing-library": "^4.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

Create `plugins/tui/tsconfig.json` — copy `plugins/schemata/tsconfig.json`, then add `"jsx": "react"` and `"jsxFactory": "React.createElement"` under `compilerOptions` (needed for `.tsx`). If the shared base config already sets `jsx`, keep it consistent; otherwise set `"jsx": "react-jsx"` and omit the factory. Create `plugins/tui/vitest.config.ts` — copy `plugins/schemata/vitest.config.ts`.

Install deps: `npm install` at the repo root (workspace picks up the new package), then verify `ink`, `react`, `ink-testing-library` resolve.

- [ ] **Step 2: Write the failing test for view resolution + TTY guard**

Create `plugins/tui/tests/unit/views.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertTty, resolveView } from "../../src/views.js";
import { ConfigError } from "dropsh/plugin";

describe("resolveView", () => {
  it("matches a view by entityType and bundle", () => {
    const v = resolveView(
      { views: [{ entityType: "node", bundle: "article", columns: ["title", "status"], pageSize: 10 }] },
      "node",
      "article",
    );
    expect(v.columns).toEqual(["title", "status"]);
    expect(v.pageSize).toBe(10);
    expect(v.detailRenderer).toBe("md");
  });

  it("falls back to defaults when no view matches", () => {
    const v = resolveView({ defaultPageSize: 42 }, "node", "page");
    expect(v.columns).toBeUndefined();
    expect(v.pageSize).toBe(42);
    expect(v.detailRenderer).toBe("md");
  });

  it("prefers a bundle-specific view over an entityType-only view", () => {
    const v = resolveView(
      { views: [{ entityType: "node" }, { entityType: "node", bundle: "article", columns: ["title"] }] },
      "node",
      "article",
    );
    expect(v.columns).toEqual(["title"]);
  });
});

describe("assertTty", () => {
  it("passes when a TTY is present", () => {
    expect(() => assertTty(true)).not.toThrow();
  });
  it("throws ConfigError without a TTY", () => {
    expect(() => assertTty(false)).toThrow(ConfigError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --root plugins/tui plugins/tui/tests/unit/views.test.ts`
Expected: FAIL — cannot find module `../../src/views.js`.

- [ ] **Step 4: Implement views + guard**

Create `plugins/tui/src/views.ts`:

```ts
import { ConfigError } from "dropsh/plugin";

export interface TuiViewConfig {
  entityType: string;
  bundle?: string;
  columns?: string[];
  filters?: Record<string, string>;
  detailRenderer?: string;
  pageSize?: number;
}

export interface TuiOptions {
  views?: TuiViewConfig[];
  defaultPageSize?: number;
  detailRenderer?: string;
}

export interface ResolvedView {
  columns?: string[];
  filters: Record<string, string>;
  detailRenderer: string;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 25;

export function resolveView(opts: TuiOptions, entityType: string, bundle?: string): ResolvedView {
  const views = opts.views ?? [];
  const withBundle = views.find((v) => v.entityType === entityType && v.bundle === bundle);
  const typeOnly = views.find((v) => v.entityType === entityType && v.bundle === undefined);
  const match = withBundle ?? typeOnly;
  const resolved: ResolvedView = {
    filters: match?.filters ?? {},
    detailRenderer: match?.detailRenderer ?? opts.detailRenderer ?? "md",
    pageSize: match?.pageSize ?? opts.defaultPageSize ?? DEFAULT_PAGE_SIZE,
  };
  if (match?.columns !== undefined) resolved.columns = match.columns;
  return resolved;
}

export function assertTty(isTty: boolean): void {
  if (!isTty) {
    throw new ConfigError("browse requires an interactive terminal");
  }
}
```

- [ ] **Step 5: Run the views test to confirm it passes**

Run: `npm run build && npx vitest run --root plugins/tui plugins/tui/tests/unit/views.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing test for the Browse component**

Create `plugins/tui/tests/unit/browse-app.test.tsx`:

```tsx
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { Browse } from "../../src/browse-app.js";
import type { JsonApiClient } from "dropsh/plugin";

function fakeClient(): JsonApiClient {
  return {
    get: vi.fn(async () => ({
      data: [
        { type: "node--article", id: "u1", attributes: { title: "Alpha" } },
        { type: "node--article", id: "u2", attributes: { title: "Beta" } },
      ],
    })),
    post: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn(),
  } as unknown as JsonApiClient;
}

const tick = () => new Promise((r) => setTimeout(r, 10));

describe("Browse", () => {
  it("renders the fetched list rows", async () => {
    const { lastFrame } = render(
      <Browse client={fakeClient()} entityType="node" bundle="article" view={{ filters: {}, detailRenderer: "md", pageSize: 25 }} />,
    );
    await tick();
    expect(lastFrame()).toContain("Alpha");
    expect(lastFrame()).toContain("Beta");
  });
});
```

- [ ] **Step 7: Run the Browse test to verify it fails**

Run: `npx vitest run --root plugins/tui plugins/tui/tests/unit/browse-app.test.tsx`
Expected: FAIL — cannot find module `../../src/browse-app.js`.

- [ ] **Step 8: Implement the Browse component**

Create `plugins/tui/src/browse-app.tsx`:

```tsx
import { renderMarkdown } from "@dropsh/plugin-markdown/render";
import type { JsonApiClient, JsonApiResource } from "dropsh/plugin";
import { DrupalJsonApiParams } from "drupal-jsonapi-params";
import { Box, Text, useApp, useInput } from "ink";
import React, { useEffect, useState } from "react";
import type { ResolvedView } from "./views.js";

export interface BrowseProps {
  client: JsonApiClient;
  entityType: string;
  bundle?: string;
  view: ResolvedView;
}

function label(res: JsonApiResource): string {
  const attrs = res.attributes ?? {};
  const cols = view => view; // placeholder to keep lints quiet; real label below
  const preferred = ["title", "name", "label"];
  for (const key of preferred) {
    const v = attrs[key];
    if (typeof v === "string") return v;
  }
  return res.id;
}

export function Browse({ client, entityType, bundle, view }: BrowseProps): React.ReactElement {
  const { exit } = useApp();
  const [rows, setRows] = useState<JsonApiResource[]>([]);
  const [selected, setSelected] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new DrupalJsonApiParams();
    for (const [k, v] of Object.entries(view.filters)) params.addFilter(k, v);
    params.addPageLimit(view.pageSize);
    const path = bundle ? `${entityType}/${bundle}` : entityType;
    client
      .get(path, params)
      .then((doc) => setRows(Array.isArray(doc.data) ? doc.data : [doc.data]))
      .catch((e) => setError(String(e)));
  }, [client, entityType, bundle, view]);

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      if (detail) setDetail(null);
      else exit();
      return;
    }
    if (detail) return;
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(rows.length - 1, s + 1));
    if (key.return && rows[selected]) {
      setDetail(renderMarkdown({ data: rows[selected] }, { command: "read" }));
    }
  });

  if (error) return <Text color="red">{error}</Text>;
  if (detail) {
    return (
      <Box flexDirection="column">
        <Text>{detail}</Text>
        <Text dimColor>(esc/q: back)</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      {rows.map((res, i) => (
        <Text key={res.id} inverse={i === selected}>
          {label(res)}
        </Text>
      ))}
      {rows.length === 0 ? <Text dimColor>loading…</Text> : null}
      <Text dimColor>(↑/↓: move, enter: open, q: quit)</Text>
    </Box>
  );
}
```

Note: delete the `cols` placeholder line inside `label` before finishing — it exists only to illustrate; the function's real logic is the `preferred` loop. Final `label`:

```tsx
function label(res: JsonApiResource): string {
  const attrs = res.attributes ?? {};
  for (const key of ["title", "name", "label"]) {
    const v = attrs[key];
    if (typeof v === "string") return v;
  }
  return res.id;
}
```

- [ ] **Step 9: Run the Browse test to confirm it passes**

Run: `npm run build && npx vitest run --root plugins/tui plugins/tui/tests/unit/browse-app.test.tsx`
Expected: PASS — frame contains `Alpha` and `Beta`.

- [ ] **Step 10: Implement the plugin factory + browse command**

Create `plugins/tui/src/index.ts`:

```ts
import { createCommandContext, type DrupalCliPlugin } from "dropsh/plugin";
import { assertTty, resolveView, type TuiOptions } from "./views.js";

export type { TuiOptions, TuiViewConfig } from "./views.js";

export function tuiPlugin(tuiOpts: TuiOptions = {}): DrupalCliPlugin {
  return {
    id: "tui",
    requiredModules: [],
    async extendSchema(_entityType, _bundle, schema) {
      return schema;
    },
    registerCommands(program) {
      program
        .command("browse <entity_type>")
        .description("Interactively browse entities in a full-screen TUI")
        .option("--bundle <bundle>")
        .action(async (entityType: string, o: { bundle?: string }) => {
          try {
            assertTty(Boolean(process.stdout.isTTY));
            const configPath =
              (program.opts().config as string | undefined) ??
              process.env.DROPSH_CONFIG ??
              "dropsh.config.js";
            const ctx = await createCommandContext(configPath);
            const view = resolveView(tuiOpts, entityType, o.bundle);
            const [{ render }, React, { Browse }] = await Promise.all([
              import("ink"),
              import("react"),
              import("./browse-app.js"),
            ]);
            const props = { client: ctx.client, entityType, view, ...(o.bundle !== undefined ? { bundle: o.bundle } : {}) };
            const app = render(React.createElement(Browse, props));
            await app.waitUntilExit();
          } catch (err) {
            const code = (err as { code?: string }).code === "E_CONFIG" ? "E_CONFIG" : "E_UNKNOWN";
            process.stderr.write(`${JSON.stringify({ error: { code, message: (err as Error).message ?? String(err), details: {} } })}\n`);
            process.exitCode = code === "E_CONFIG" ? 2 : 1;
          }
        });
    },
  };
}
```

- [ ] **Step 11: Run the full plugin suite + typecheck**

Run: `npm run build && npx vitest run --root plugins/tui && npm --prefix plugins/tui run typecheck`
Expected: all tui tests PASS; typecheck PASS.

- [ ] **Step 12: Commit**

```bash
git add plugins/tui
git commit -m "feat: add @dropsh/plugin-tui interactive browse command"
```

---

## Task 8: Build wiring, example config, and docs

**Files:**
- Modify: `package.json` (`build:plugins` script)
- Modify: `dropsh.config.example.js`
- Modify: `README.md`
- Test: `tests/unit/plugins-integration.test.ts`

**Interfaces:**
- Consumes: `buildProgram`, `markdownPlugin`, `tablePlugin` — verifies renderers register end-to-end through the program.

- [ ] **Step 1: Write the failing integration test**

Create `tests/unit/plugins-integration.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildProgram, type CommandContext } from "../../src/index.js";
import { markdownPlugin } from "../../plugins/markdown/src/index.js";
import { tablePlugin } from "../../plugins/table/src/index.js";
import type { JsonApiClient } from "../../src/core/jsonapi/client.js";

function fakeClient(): JsonApiClient {
  return {
    get: vi.fn(async () => ({ data: { type: "node--article", id: "u1", attributes: { title: "Hi" } } })),
    post: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn(),
  } as unknown as JsonApiClient;
}

describe("renderer plugins wired through buildProgram", () => {
  it("renders read output as markdown when both renderer plugins are loaded", async () => {
    const plugins = [markdownPlugin(), tablePlugin()];
    const out: string[] = [];
    const program = buildProgram({
      plugins,
      contextFactory: async () => ({ client: fakeClient(), plugins } as unknown as CommandContext),
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    await program.parseAsync(["node", "dropsh", "--format", "md", "read", "node/article/abcdef01-abcd-abcd-abcd-abcdef012345"]);
    expect(out.join("")).toContain("type: node--article");
    expect(out.join("")).toContain("title: Hi");
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npx vitest run tests/unit/plugins-integration.test.ts`
Expected: PASS if Tasks 4-6 are complete (this test guards the end-to-end wiring; if it fails, the failure pinpoints a wiring regression). Treat a failure here as a signal to revisit Task 4/5.

- [ ] **Step 3: Extend the `build:plugins` script**

In `package.json`, replace the `build:plugins` script value with:

```
"build:plugins": "npm --prefix plugins/schemata run build && npm --prefix plugins/oauth2 run build && npm --prefix plugins/markdown run build && npm --prefix plugins/table run build && npm --prefix plugins/tui run build"
```

- [ ] **Step 4: Update the example config**

In `dropsh.config.example.js`, add commented imports near the existing ones:

```js
// import { markdownPlugin } from '@dropsh/plugin-markdown';
// import { tablePlugin } from '@dropsh/plugin-table';
// import { tuiPlugin } from '@dropsh/plugin-tui';
```

And in the `plugins: [ … ]` array add commented entries:

```js
    // markdownPlugin(),
    // tablePlugin(),
    // tuiPlugin({
    //   defaultPageSize: 25,
    //   views: [
    //     { entityType: 'node', bundle: 'article', columns: ['title', 'status', 'changed'], filters: { status: '1' } },
    //   ],
    // }),
```

- [ ] **Step 5: Document the feature in README**

In `README.md`, add a `### Output formats` subsection under `## Commands`:

````markdown
### Output formats

By default every command emits JSON. Load a renderer plugin and pass a global
`--format <id>` (before the subcommand) to render entities differently:

```bash
dropsh --format md read node/article/<uuid>      # Markdown detail view
dropsh --format table search node --bundle=article  # aligned table
```

`--format` applies only to entity commands (`read`, `search`, `create`,
`update`). Using it on `delete`, `upload-file`, or `schema` exits with code 2.

The `@dropsh/plugin-tui` plugin adds an interactive browser:

```bash
dropsh browse node --bundle=article   # requires an interactive terminal
```
````

- [ ] **Step 6: Run the full validation suite**

Run: `npm run build && npm run build:plugins && npm run lint && npm run typecheck && npm test`
Expected: all PASS across Node's default. Plugin packages build without error.

- [ ] **Step 7: Commit**

```bash
git add package.json dropsh.config.example.js README.md tests/unit/plugins-integration.test.ts
git commit -m "feat: wire renderer/tui plugins into build, example config, and docs"
```

---

## Self-Review Notes

- **Spec coverage:** Renderer API (Task 2), `json` default + backward compat (Task 2/4), `--format` global flag + guards (Task 4), JSON:API types moved to `core/jsonapi/types.ts` + client tightening (Task 1), `md`/`table`/`tui` base plugins (Tasks 5/6/7), TUI config surface `TuiOptions`/`TuiViewConfig` + view resolution (Task 7), non-TTY guard (Task 7), dry-run/non-document → JSON (Task 2), errors always JSON (Task 2), empty-collection handling (Tasks 5/6), plugin-api re-exports for plugin commands (Task 3). All spec sections map to a task.
- **Type consistency:** `renderMarkdown`/`renderTable` signatures match the `Renderer.render` contract from `render.ts`; `Renderer`, `RenderContext`, `JsonApiDocument`, `JsonApiResource`, `CommandContext`, `createCommandContext`, `createJsonApiClient` are all re-exported from `dropsh/plugin` (Task 3) before any plugin imports them (Tasks 5-7); `resolveView` returns `ResolvedView` consumed by `Browse`.
- **Non-goals honored:** no template engine, no TUI editing, no hard-coded per-bundle renderers in core.
