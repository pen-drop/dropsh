# schema command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `drupal-cli schema` with two modes — no-argument catalog listing and per-target JSON Schema — backed by a hybrid source strategy (contrib `schemata` when available, sample-record heuristic otherwise), a file-based cache under `.drupal-cli/cache/`, and client-side payload validation hooked into `create`/`update`.

**Architecture:** New module tree under `src/core/schema/` with three seams — catalog / per-target source / validator. The per-target source is a dispatcher that first tries `GET /schemata/{e}/{b}?_format=schema_json&_describes=api_json` and falls back to `GET /jsonapi/{e}/{b}?page[limit]=3` when schemata is absent. A new `src/core/cache/file-store.ts` does atomic file-backed caching. `create` and `update` gain a pre-flight validation step (opt-out via `--no-validate`). Integration tests run against two DDEV setups: the existing `drupal/` (no schemata, exercises the heuristic path) and a new `drupal-schemata/` (exercises the schemata path plus client-side validation).

**Tech Stack:** Node.js 20+, TypeScript 5, Commander, Ajv 8 (JSON Schema validator, Draft-7 meta), vitest, DDEV (local integration fixture).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add `ajv` runtime dependency |
| `src/index.ts` | Modify | Register `schema` command; extend `CommandContext` with `http`, `auth`, `baseUrl` |
| `src/core/cache/file-store.ts` | Create | Atomic read/write under `.drupal-cli/cache/`, warn on corrupt / failed writes |
| `src/core/schema/catalog.ts` | Create | `GET /jsonapi` → `[{entity_type, bundle, label}]` |
| `src/core/schema/sources/schemata.ts` | Create | `GET /schemata/{e}/{b}?_format=schema_json&_describes=api_json`; 200 → JSON Schema, 404 → signal miss, other → HttpError |
| `src/core/schema/sources/heuristic.ts` | Create | Build shallow schema from up-to-3 sample records or envelope-only for empty bundles |
| `src/core/schema/jsonschema-source.ts` | Create | Dispatcher: schemata → heuristic fallback, tag `x-drupal-cli-source` |
| `src/core/schema/to-jsonschema.ts` | Create | Post-process for `--for=create\|update` |
| `src/core/schema/validate.ts` | Create | Ajv wrapper: compile (Draft-7 meta), validate, throw `ValidationError` with Ajv error list on failure |
| `src/commands/schema.ts` | Create | Dispatcher: no arg → catalog; target → per-target schema. Handles `--refresh`, `--for`, caching |
| `src/commands/create.ts` | Modify | Add `--no-validate` flag; run validator step before POST unless disabled |
| `src/commands/update.ts` | Modify | Add `--no-validate` flag; run validator step before PATCH unless disabled |
| `tests/unit/core/cache/file-store.test.ts` | Create | Unit tests: atomic write, read miss/hit, corrupt JSON, write failure warnings |
| `tests/unit/core/schema/validate.test.ts` | Create | Unit tests: Ajv compile + validate, pass/fail, error shape |
| `tests/unit/core/schema/to-jsonschema.test.ts` | Create | Unit tests: `--for=create` no-op; `--for=update` clears required at attributes, adds `id` required |
| `tests/unit/core/schema/sources/schemata.test.ts` | Create | Unit tests: URL build, 200 / 404 / 5xx / non-JSON |
| `tests/unit/core/schema/sources/heuristic.test.ts` | Create | Unit tests: 3-record sample, empty bundle, type inference, relationships |
| `tests/unit/core/schema/jsonschema-source.test.ts` | Create | Unit tests: dispatcher happy/fallback/both-fail, source tagging |
| `tests/unit/core/schema/catalog.test.ts` | Create | Unit tests: parse `/jsonapi` root, labels, user (no bundles) |
| `tests/unit/commands/schema.test.ts` | Create | Unit tests: no-arg path, target path, `--refresh`, error paths |
| `tests/unit/commands/create.test.ts` | Modify | Extend: validator passes; validator fails → ValidationError; `--no-validate` bypasses |
| `tests/unit/commands/update.test.ts` | Modify | Extend: same as create |
| `tests/unit/fixtures/jsonapi-root.json` | Create | JSON:API root-index sample |
| `tests/unit/fixtures/schemata/node--article.schema.json` | Create | Real schemata_json_schema dump for node/article |
| `tests/unit/fixtures/samples/node--article-3-records.json` | Create | 3 sample JSON:API records for heuristic |
| `tests/unit/fixtures/samples/node--empty-bundle.json` | Create | `{"data": []}` |
| `tests/unit/fixtures/payloads/article-valid.json` | Create | JSON:API payload that passes validation |
| `tests/unit/fixtures/payloads/article-missing-title.json` | Create | JSON:API payload that fails validation |
| `tests/integrations/helpers/run.ts` | Modify | Add `withDrupalSchemata` variant of `runCli` (uses `drupal-schemata/.test-config.json`) |
| `tests/integrations/schema/schema-list.integration.test.ts` | Create | Against `drupal/`: catalog lists article_test + tags |
| `tests/integrations/schema/schema-heuristic.integration.test.ts` | Create | Against `drupal/`: heuristic schema output, source tag, warning on stderr |
| `tests/integrations/schema/schema-heuristic-empty-bundle.integration.test.ts` | Create | Against `drupal/`: empty bundle → envelope-only schema |
| `tests/integrations/schema/schema-refresh.integration.test.ts` | Create | Against `drupal/`: cache hit vs `--refresh` request counts |
| `tests/integrations/schema/schema-cache-persistence.integration.test.ts` | Create | Against `drupal/`: cache file written under `.drupal-cli/cache/` |
| `tests/integrations/schema/schema-unknown-target.integration.test.ts` | Create | Against `drupal/`: unknown bundle → exit 4, error code `E_VALIDATION` |
| `tests/integrations/schema/schema-jsonschema-create.integration.test.ts` | Create | Against `drupal-schemata/`: create-schema with required fields, validator compiles, valid & invalid payloads |
| `tests/integrations/schema/schema-jsonschema-update.integration.test.ts` | Create | Against `drupal-schemata/`: update-schema, partial payload accepted |
| `tests/integrations/schema/schema-validates-create-payload.integration.test.ts` | Create | Against `drupal-schemata/`: bad payload → client-side fail, no HTTP POST |
| `tests/integrations/drupal-schemata/` | Create | Second DDEV fixture (composer.json, .ddev/config.yaml, fixtures/, recipes/) |
| `tests/integrations/bin/drupal-schemata-up.sh` | Create | Boot script for the second fixture (composer require schemata, drush en) |
| `tests/integrations/bin/drupal-schemata-down.sh` | Create | Teardown for the second fixture |
| `package.json` | Modify | Add `drupal-schemata:up`/`drupal-schemata:down` npm scripts |
| `README.md` | Modify | Document `schema` command and `.drupal-cli/cache/` gitignore line |

---

## Task 1: Add Ajv dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install ajv**

Run:
```bash
npm install ajv@^8
```

Expected: `ajv` appears under `dependencies` with version `^8.x`.

- [ ] **Step 2: Verify typecheck still passes**

Run:
```bash
npm run typecheck
```

Expected: exit 0, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add ajv 8 for JSON Schema validation"
```

---

## Task 2: Cache file-store (tests + implementation)

**Files:**
- Create: `src/core/cache/file-store.ts`
- Create: `tests/unit/core/cache/file-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/cache/file-store.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../../../../src/core/cache/file-store.js";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "drupal-cli-cache-"));
}

describe("createFileStore", () => {
  it("writes atomically and reads the value back", async () => {
    const dir = freshDir();
    const warnings: string[] = [];
    const store = createFileStore({ rootDir: dir, warn: (m) => warnings.push(m) });
    await store.write("catalog.json", { hello: "world" });
    const v = await store.read<{ hello: string }>("catalog.json");
    expect(v).toEqual({ hello: "world" });
    expect(warnings).toEqual([]);
  });

  it("returns undefined on read miss", async () => {
    const dir = freshDir();
    const store = createFileStore({ rootDir: dir, warn: () => {} });
    expect(await store.read("missing.json")).toBeUndefined();
  });

  it("treats corrupt JSON as a miss and warns", async () => {
    const dir = freshDir();
    writeFileSync(join(dir, "bad.json"), "{not json");
    const warnings: string[] = [];
    const store = createFileStore({ rootDir: dir, warn: (m) => warnings.push(m) });
    expect(await store.read("bad.json")).toBeUndefined();
    expect(warnings.some((w) => w.includes("unreadable"))).toBe(true);
  });

  it("creates intermediate directories on write", async () => {
    const dir = freshDir();
    const store = createFileStore({ rootDir: dir, warn: () => {} });
    await store.write("schema/node--article.create.json", { a: 1 });
    const on_disk = JSON.parse(readFileSync(join(dir, "schema/node--article.create.json"), "utf8"));
    expect(on_disk).toEqual({ a: 1 });
  });

  it("does not throw when write fails; emits warning instead", async () => {
    const dir = freshDir();
    chmodSync(dir, 0o500); // read+execute, no write
    const warnings: string[] = [];
    const store = createFileStore({ rootDir: dir, warn: (m) => warnings.push(m) });
    await store.write("blocked.json", { a: 1 });
    expect(warnings.some((w) => w.includes("could not update cache"))).toBe(true);
    chmodSync(dir, 0o700); // restore for cleanup
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/core/cache/file-store.test.ts`
Expected: FAIL — `createFileStore` not found.

- [ ] **Step 3: Write implementation**

Create `src/core/cache/file-store.ts`:

```typescript
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface FileStore {
  read<T>(relPath: string): Promise<T | undefined>;
  write(relPath: string, value: unknown): Promise<void>;
}

export interface FileStoreOptions {
  rootDir: string;
  warn: (message: string) => void;
}

export function createFileStore(opts: FileStoreOptions): FileStore {
  function resolve(rel: string): string {
    return join(opts.rootDir, rel);
  }

  return {
    async read<T>(relPath) {
      const abs = resolve(relPath);
      let raw: string;
      try {
        raw = await readFile(abs, "utf8");
      } catch {
        return undefined;
      }
      try {
        return JSON.parse(raw) as T;
      } catch {
        opts.warn(`warning: cache file ${abs} was unreadable and has been refetched`);
        return undefined;
      }
    },

    async write(relPath, value) {
      const abs = resolve(relPath);
      const tmp = `${abs}.tmp`;
      try {
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
        await rename(tmp, abs);
      } catch (err) {
        opts.warn(`warning: could not update cache at ${abs}: ${(err as Error).message}`);
      }
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/core/cache/file-store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/cache/file-store.ts tests/unit/core/cache/file-store.test.ts
git commit -m "feat(cache): atomic file-backed store under .drupal-cli/cache/"
```

---

## Task 3: Schema validator (Ajv wrapper)

**Files:**
- Create: `src/core/schema/validate.ts`
- Create: `tests/unit/core/schema/validate.test.ts`
- Create: `tests/unit/fixtures/payloads/article-valid.json`
- Create: `tests/unit/fixtures/payloads/article-missing-title.json`

- [ ] **Step 1: Create payload fixtures**

Create `tests/unit/fixtures/payloads/article-valid.json`:

```json
{
  "data": {
    "type": "node--article",
    "attributes": {
      "title": "Hello",
      "body": { "value": "Content", "format": "plain_text" }
    }
  }
}
```

Create `tests/unit/fixtures/payloads/article-missing-title.json`:

```json
{
  "data": {
    "type": "node--article",
    "attributes": {
      "body": { "value": "Content", "format": "plain_text" }
    }
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/core/schema/validate.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validatePayload } from "../../../../src/core/schema/validate.js";
import { ValidationError } from "../../../../src/errors.js";

function load<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/payloads", name), "utf8")) as T;
}

const schema = {
  $schema: "https://json-schema.org/draft-07/schema",
  type: "object",
  properties: {
    data: {
      type: "object",
      properties: {
        type: { const: "node--article" },
        attributes: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "object" },
          },
          required: ["title"],
        },
      },
      required: ["type", "attributes"],
    },
  },
  required: ["data"],
};

describe("validatePayload", () => {
  it("returns ok for a valid payload", () => {
    const payload = load("article-valid.json");
    expect(() => validatePayload(schema, payload, "node/article")).not.toThrow();
  });

  it("throws ValidationError with ajv errors when required field missing", () => {
    const payload = load("article-missing-title.json");
    let caught: unknown;
    try {
      validatePayload(schema, payload, "node/article");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const e = caught as ValidationError;
    expect(e.message).toContain("node/article");
    const errs = e.details.errors as Array<{ instancePath: string; message: string }>;
    expect(errs.some((x) => x.instancePath === "/data/attributes" && /required/i.test(x.message))).toBe(true);
  });

  it("throws ValidationError when schema itself cannot be compiled", () => {
    const bad = { type: "not-a-type" };
    let caught: unknown;
    try {
      validatePayload(bad, {}, "node/article");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).message).toMatch(/cannot be compiled/);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/unit/core/schema/validate.test.ts`
Expected: FAIL — `validatePayload` not found.

- [ ] **Step 4: Write implementation**

Create `src/core/schema/validate.ts`:

```typescript
import Ajv, { type ErrorObject } from "ajv";
import draft7MetaSchema from "ajv/dist/refs/json-schema-draft-07.json" with { type: "json" };
import { ValidationError } from "../../errors.js";

export function validatePayload(schema: unknown, payload: unknown, target: string): void {
  const ajv = new Ajv({ allErrors: true, strict: false });
  if (!ajv.getSchema("http://json-schema.org/draft-07/schema")) {
    ajv.addMetaSchema(draft7MetaSchema);
  }

  let validate;
  try {
    validate = ajv.compile(schema as object);
  } catch (err) {
    throw new ValidationError(
      `schema for ${target} cannot be compiled: ${(err as Error).message}`,
      { cause: String(err) },
    );
  }

  const ok = validate(payload);
  if (!ok) {
    const errors = (validate.errors ?? []) as ErrorObject[];
    throw new ValidationError(
      `payload does not match schema for ${target}`,
      { errors },
    );
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/core/schema/validate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/schema/validate.ts tests/unit/core/schema/validate.test.ts tests/unit/fixtures/payloads
git commit -m "feat(schema): Ajv-backed payload validator"
```

---

## Task 4: `--for=create|update` post-processing

**Files:**
- Create: `src/core/schema/to-jsonschema.ts`
- Create: `tests/unit/core/schema/to-jsonschema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/schema/to-jsonschema.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { toOperationVariant } from "../../../../src/core/schema/to-jsonschema.js";

function baseSchema() {
  return {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          type: { const: "node--article" },
          id: { type: "string", format: "uuid" },
          attributes: {
            type: "object",
            properties: { title: { type: "string" }, body: { type: "object" } },
            required: ["title"],
          },
          relationships: {
            type: "object",
            properties: { field_tags: { type: "object" } },
            required: ["field_tags"],
          },
        },
        required: ["type", "attributes"],
      },
    },
    required: ["data"],
  };
}

describe("toOperationVariant", () => {
  it("leaves schema intact for create", () => {
    const input = baseSchema();
    const out = toOperationVariant(input, "create");
    expect(out).toEqual(input);
  });

  it("for update: clears required under data.attributes and data.relationships", () => {
    const out = toOperationVariant(baseSchema(), "update") as any;
    expect(out.properties.data.properties.attributes.required).toEqual([]);
    expect(out.properties.data.properties.relationships.required).toEqual([]);
  });

  it("for update: replaces data.required with ['type','id']", () => {
    const out = toOperationVariant(baseSchema(), "update") as any;
    expect(out.properties.data.required).toEqual(["type", "id"]);
  });

  it("does not mutate input", () => {
    const input = baseSchema();
    const before = JSON.stringify(input);
    toOperationVariant(input, "update");
    expect(JSON.stringify(input)).toBe(before);
  });

  it("is tolerant of schemas without attributes/relationships blocks", () => {
    const thin = { type: "object", properties: { data: { type: "object", properties: { type: { const: "x--y" } }, required: ["type"] } } };
    const out = toOperationVariant(thin, "update") as any;
    expect(out.properties.data.required).toEqual(["type", "id"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/core/schema/to-jsonschema.test.ts`
Expected: FAIL — `toOperationVariant` not found.

- [ ] **Step 3: Write implementation**

Create `src/core/schema/to-jsonschema.ts`:

```typescript
export type Operation = "create" | "update";

export function toOperationVariant(schema: unknown, op: Operation): unknown {
  if (op === "create") return schema;
  const cloned = JSON.parse(JSON.stringify(schema)) as Record<string, any>;
  const data = cloned?.properties?.data;
  if (data && typeof data === "object") {
    data.required = ["type", "id"];
    if (data.properties?.attributes) data.properties.attributes.required = [];
    if (data.properties?.relationships) data.properties.relationships.required = [];
  }
  return cloned;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/core/schema/to-jsonschema.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/schema/to-jsonschema.ts tests/unit/core/schema/to-jsonschema.test.ts
git commit -m "feat(schema): --for=create|update operation variant"
```

---

## Task 5: Extend `CommandContext` with `http`, `auth`, `baseUrl`, `jsonapiPrefix`

The `schema` command needs raw HTTP access because `GET /schemata/...` and `GET /jsonapi` (root, no path) do not fit cleanly through `JsonApiClient`. Expose the primitives.

**Files:**
- Modify: `src/index.ts`
- Modify: existing unit tests that construct `CommandContext` (none currently do — the factory is wrapped; verify).

- [ ] **Step 1: Modify `CommandContext` in `src/index.ts`**

Locate the interface and extend it:

```typescript
export interface CommandContext {
  client: JsonApiClient;
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  jsonapiPrefix: string;
  cwd: string;
}
```

Update the imports to include:

```typescript
import type { HttpClient } from "./core/http.js";
import type { AuthAdapter } from "./core/auth/types.js";
```

- [ ] **Step 2: Populate the new fields in `defaultContext`**

Replace the existing `defaultContext` body so it returns the full record:

```typescript
async function defaultContext(): Promise<CommandContext> {
  const cfg = await loadConfig(process.env.DRUPAL_CLI_CONFIG ?? ".drupal-cli.yml");
  const http = createHttpClient({ timeoutMs: cfg.defaults.timeout_ms });
  const auth = createAuthAdapter(cfg.site.auth, { http, baseUrl: cfg.site.base_url });
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
  };
}
```

- [ ] **Step 3: Run typecheck + existing tests**

Run: `npm run typecheck && npx vitest run`
Expected: PASS — no new failures (existing tests use the wrapped `run(...)` and do not touch new fields).

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "refactor(ctx): expose http, auth, baseUrl, jsonapiPrefix, cwd on CommandContext"
```

---

## Task 6: Catalog source

**Files:**
- Create: `src/core/schema/catalog.ts`
- Create: `tests/unit/core/schema/catalog.test.ts`
- Create: `tests/unit/fixtures/jsonapi-root.json`

- [ ] **Step 1: Create fixture**

Create `tests/unit/fixtures/jsonapi-root.json`:

```json
{
  "jsonapi": { "version": "1.0" },
  "data": [],
  "links": {
    "node--article": { "href": "https://ex/jsonapi/node/article", "meta": { "title": "Article" } },
    "node--page":    { "href": "https://ex/jsonapi/node/page",    "meta": { "title": "Basic page" } },
    "taxonomy_term--tags": { "href": "https://ex/jsonapi/taxonomy_term/tags" },
    "user--user":    { "href": "https://ex/jsonapi/user/user" },
    "self":          { "href": "https://ex/jsonapi" }
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/core/schema/catalog.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchCatalog } from "../../../../src/core/schema/catalog.js";
import type { HttpClient } from "../../../../src/core/http.js";
import type { AuthAdapter } from "../../../../src/core/auth/types.js";

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
    const [row] = await fetchCatalog({ http: httpWithBody(body), auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi" });
    expect(row.label).toBe("Basic page");
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/unit/core/schema/catalog.test.ts`
Expected: FAIL — `fetchCatalog` not found.

- [ ] **Step 4: Write implementation**

Create `src/core/schema/catalog.ts`:

```typescript
import type { HttpClient } from "../http.js";
import type { AuthAdapter } from "../auth/types.js";
import { HttpError } from "../../errors.js";

export interface CatalogEntry {
  entity_type: string;
  bundle: string;
  label: string;
}

export interface CatalogDeps {
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  jsonapiPrefix: string;
}

function prettify(machine: string): string {
  const spaced = machine.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export async function fetchCatalog(deps: CatalogDeps): Promise<CatalogEntry[]> {
  const url = `${deps.baseUrl.replace(/\/+$/, "")}${deps.jsonapiPrefix.startsWith("/") ? deps.jsonapiPrefix : `/${deps.jsonapiPrefix}`}`;
  const req = await deps.auth.apply({
    method: "GET",
    url,
    headers: { Accept: "application/vnd.api+json" },
  });
  const res = await deps.http.send(req);
  if (res.status < 200 || res.status >= 300) {
    throw new HttpError(res.status, `cannot reach ${url}: HTTP ${res.status}`, res.body);
  }
  const body = JSON.parse(res.body) as { links?: Record<string, { href?: string; meta?: { title?: string } }> };
  const links = body.links ?? {};
  const out: CatalogEntry[] = [];
  for (const [key, link] of Object.entries(links)) {
    if (!key.includes("--")) continue;
    const [entity_type, bundle] = key.split("--", 2);
    const label = link?.meta?.title ?? prettify(bundle);
    out.push({ entity_type, bundle, label });
  }
  return out;
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/core/schema/catalog.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/schema/catalog.ts tests/unit/core/schema/catalog.test.ts tests/unit/fixtures/jsonapi-root.json
git commit -m "feat(schema): catalog source from /jsonapi root index"
```

---

## Task 7: Schemata source

**Files:**
- Create: `src/core/schema/sources/schemata.ts`
- Create: `tests/unit/core/schema/sources/schemata.test.ts`
- Create: `tests/unit/fixtures/schemata/node--article.schema.json`

- [ ] **Step 1: Create fixture**

Create `tests/unit/fixtures/schemata/node--article.schema.json` (minimal representative shape; the schemata+schemata_json_schema output for node/article wraps a JSON:API envelope):

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "properties": {
    "data": {
      "type": "object",
      "properties": {
        "type": { "type": "string", "enum": ["node--article"] },
        "id": { "type": "string" },
        "attributes": {
          "type": "object",
          "properties": {
            "title": { "type": "string", "maxLength": 255 },
            "body": { "type": "object" }
          },
          "required": ["title"]
        },
        "relationships": { "type": "object", "properties": { "field_tags": { "type": "object" } } }
      },
      "required": ["type", "attributes"]
    }
  },
  "required": ["data"]
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/core/schema/sources/schemata.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchSchemata, SCHEMATA_MISS } from "../../../../../src/core/schema/sources/schemata.js";
import type { HttpClient } from "../../../../../src/core/http.js";
import type { AuthAdapter } from "../../../../../src/core/auth/types.js";
import { HttpError } from "../../../../../src/errors.js";

const auth: AuthAdapter = { apply: async (req) => req };

function http(status: number, body: string): HttpClient {
  return { send: vi.fn(async () => ({ status, headers: {}, body })) };
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/unit/core/schema/sources/schemata.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write implementation**

Create `src/core/schema/sources/schemata.ts`:

```typescript
import type { HttpClient } from "../../http.js";
import type { AuthAdapter } from "../../auth/types.js";
import { HttpError } from "../../../errors.js";

export const SCHEMATA_MISS = Symbol("SCHEMATA_MISS");

export interface SchemataDeps {
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  entity: string;
  bundle: string;
}

export async function fetchSchemata(deps: SchemataDeps): Promise<unknown | typeof SCHEMATA_MISS> {
  const base = deps.baseUrl.replace(/\/+$/, "");
  const url = `${base}/schemata/${deps.entity}/${deps.bundle}?_format=schema_json&_describes=api_json`;
  const req = await deps.auth.apply({
    method: "GET",
    url,
    headers: { Accept: "application/json" },
  });
  const res = await deps.http.send(req);
  if (res.status === 404) return SCHEMATA_MISS;
  if (res.status < 200 || res.status >= 300) {
    throw new HttpError(res.status, `cannot reach ${url}: HTTP ${res.status}`, res.body);
  }
  return JSON.parse(res.body);
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/core/schema/sources/schemata.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/schema/sources/schemata.ts tests/unit/core/schema/sources/schemata.test.ts tests/unit/fixtures/schemata
git commit -m "feat(schema): schemata_json_schema source"
```

---

## Task 8: Heuristic source (sample-record → shallow schema)

**Files:**
- Create: `src/core/schema/sources/heuristic.ts`
- Create: `tests/unit/core/schema/sources/heuristic.test.ts`
- Create: `tests/unit/fixtures/samples/node--article-3-records.json`
- Create: `tests/unit/fixtures/samples/node--empty-bundle.json`

- [ ] **Step 1: Create fixtures**

Create `tests/unit/fixtures/samples/node--article-3-records.json`:

```json
{
  "data": [
    {
      "type": "node--article",
      "id": "aaa",
      "attributes": { "title": "A", "body": { "value": "x", "format": "plain_text" }, "status": true, "sticky": null },
      "relationships": { "uid": { "data": { "type": "user--user", "id": "u1" } }, "field_tags": { "data": [] } }
    },
    {
      "type": "node--article",
      "id": "bbb",
      "attributes": { "title": "B", "body": null, "status": true, "sticky": false },
      "relationships": { "uid": { "data": { "type": "user--user", "id": "u1" } }, "field_tags": { "data": [{ "type": "taxonomy_term--tags", "id": "t1" }] } }
    },
    {
      "type": "node--article",
      "id": "ccc",
      "attributes": { "title": "C", "body": { "value": "y", "format": "plain_text" }, "status": true, "sticky": false },
      "relationships": { "uid": { "data": { "type": "user--user", "id": "u1" } } }
    }
  ]
}
```

Create `tests/unit/fixtures/samples/node--empty-bundle.json`:

```json
{ "data": [] }
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/core/schema/sources/heuristic.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchHeuristic } from "../../../../../src/core/schema/sources/heuristic.js";
import type { HttpClient } from "../../../../../src/core/http.js";
import type { AuthAdapter } from "../../../../../src/core/auth/types.js";

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
    const callArgs = send.mock.calls[0][0];
    expect(callArgs.method).toBe("GET");
    expect(callArgs.url).toBe("https://ex/jsonapi/node/article?page%5Blimit%5D=3");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/unit/core/schema/sources/heuristic.test.ts`
Expected: FAIL — `fetchHeuristic` not found.

- [ ] **Step 4: Write implementation**

Create `src/core/schema/sources/heuristic.ts`:

```typescript
import type { HttpClient } from "../../http.js";
import type { AuthAdapter } from "../../auth/types.js";
import { HttpError } from "../../../errors.js";

export interface HeuristicDeps {
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  jsonapiPrefix: string;
  entity: string;
  bundle: string;
}

export interface HeuristicResult {
  schema: unknown;
  empty: boolean;
}

type TypeMarker = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

function inferType(v: unknown): TypeMarker {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  switch (typeof v) {
    case "string": return "string";
    case "number": return Number.isInteger(v) ? "integer" : "number";
    case "boolean": return "boolean";
    default: return "object";
  }
}

function mergeTypes(types: Set<TypeMarker>): unknown {
  const arr = [...types].filter((t) => t !== undefined);
  if (arr.length === 0) return {};
  if (arr.length === 1) return { type: arr[0] };
  return { type: arr };
}

export async function fetchHeuristic(deps: HeuristicDeps): Promise<HeuristicResult> {
  const base = deps.baseUrl.replace(/\/+$/, "");
  const prefix = deps.jsonapiPrefix.startsWith("/") ? deps.jsonapiPrefix : `/${deps.jsonapiPrefix}`;
  const url = `${base}${prefix}/${deps.entity}/${deps.bundle}?page%5Blimit%5D=3`;
  const req = await deps.auth.apply({
    method: "GET",
    url,
    headers: { Accept: "application/vnd.api+json" },
  });
  const res = await deps.http.send(req);
  if (res.status < 200 || res.status >= 300) {
    throw new HttpError(res.status, `cannot reach ${url}: HTTP ${res.status}`, res.body);
  }
  const body = JSON.parse(res.body) as { data?: Array<{ attributes?: Record<string, unknown>; relationships?: Record<string, unknown> }> };
  const records = body.data ?? [];

  const resourceType = `${deps.entity}--${deps.bundle}`;
  const attrTypes = new Map<string, Set<TypeMarker>>();
  const relNames = new Set<string>();

  for (const r of records) {
    for (const [k, v] of Object.entries(r.attributes ?? {})) {
      if (!attrTypes.has(k)) attrTypes.set(k, new Set());
      attrTypes.get(k)!.add(inferType(v));
    }
    for (const k of Object.keys(r.relationships ?? {})) relNames.add(k);
  }

  const attrProps: Record<string, unknown> = {};
  for (const [k, types] of attrTypes) attrProps[k] = mergeTypes(types);

  const relProps: Record<string, unknown> = {};
  for (const k of relNames) {
    relProps[k] = {
      type: "object",
      properties: {
        data: {
          oneOf: [
            { type: "object", properties: { type: { type: "string" }, id: { type: "string", format: "uuid" } }, required: ["type", "id"] },
            { type: "array", items: { type: "object", properties: { type: { type: "string" }, id: { type: "string", format: "uuid" } }, required: ["type", "id"] } },
            { type: "null" },
          ],
        },
      },
    };
  }

  const schema = {
    $schema: "https://json-schema.org/draft-07/schema",
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          type: { const: resourceType },
          id: { type: "string", format: "uuid" },
          attributes: { type: "object", properties: attrProps, required: [] as string[] },
          relationships: { type: "object", properties: relProps, required: [] as string[] },
        },
        required: ["type"],
      },
    },
    required: ["data"],
  };

  return { schema, empty: records.length === 0 };
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/core/schema/sources/heuristic.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/schema/sources/heuristic.ts tests/unit/core/schema/sources/heuristic.test.ts tests/unit/fixtures/samples
git commit -m "feat(schema): heuristic source from sample records"
```

---

## Task 9: Dispatcher (jsonschema-source.ts)

**Files:**
- Create: `src/core/schema/jsonschema-source.ts`
- Create: `tests/unit/core/schema/jsonschema-source.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/schema/jsonschema-source.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { fetchJsonSchema } from "../../../../src/core/schema/jsonschema-source.js";
import { SCHEMATA_MISS } from "../../../../src/core/schema/sources/schemata.js";
import type { HttpClient } from "../../../../src/core/http.js";
import type { AuthAdapter } from "../../../../src/core/auth/types.js";
import { ValidationError } from "../../../../src/errors.js";

const auth: AuthAdapter = { apply: async (req) => req };

function scriptedHttp(responses: Array<{ status: number; body: string }>): HttpClient {
  let i = 0;
  return { send: vi.fn(async () => responses[i++]) };
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/core/schema/jsonschema-source.test.ts`
Expected: FAIL — `fetchJsonSchema` not found.

- [ ] **Step 3: Write implementation**

Create `src/core/schema/jsonschema-source.ts`:

```typescript
import type { HttpClient } from "../http.js";
import type { AuthAdapter } from "../auth/types.js";
import { HttpError, ValidationError } from "../../errors.js";
import { fetchSchemata, SCHEMATA_MISS } from "./sources/schemata.js";
import { fetchHeuristic } from "./sources/heuristic.js";

export type SchemaSource = "schemata" | "heuristic" | "heuristic-empty";

export interface JsonSchemaResult {
  schema: unknown;
  source: SchemaSource;
  target: { entity_type: string; bundle: string };
}

export interface JsonSchemaDeps {
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  jsonapiPrefix: string;
  entity: string;
  bundle: string;
  warn: (message: string) => void;
}

export async function fetchJsonSchema(deps: JsonSchemaDeps): Promise<JsonSchemaResult> {
  const { entity, bundle } = deps;
  const target = { entity_type: entity, bundle };

  const schematic = await fetchSchemata({
    http: deps.http, auth: deps.auth, baseUrl: deps.baseUrl, entity, bundle,
  });
  if (schematic !== SCHEMATA_MISS) {
    return { schema: schematic, source: "schemata", target };
  }

  // Fallback: heuristic
  let heuristic;
  try {
    heuristic = await fetchHeuristic({
      http: deps.http, auth: deps.auth, baseUrl: deps.baseUrl, jsonapiPrefix: deps.jsonapiPrefix, entity, bundle,
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw new ValidationError(
        `no such target '${entity}/${bundle}'. Run 'drupal-cli schema' to see available targets.`,
        { entity, bundle },
      );
    }
    throw err;
  }

  if (heuristic.empty) {
    deps.warn(`warning: bundle '${entity}/${bundle}' has no instances and no 'schemata' module; returning envelope-only schema`);
    return { schema: heuristic.schema, source: "heuristic-empty", target };
  }

  deps.warn(`warning: site has no 'schemata' module; returning heuristic schema (no required fields, no constraints)`);
  return { schema: heuristic.schema, source: "heuristic", target };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/core/schema/jsonschema-source.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/schema/jsonschema-source.ts tests/unit/core/schema/jsonschema-source.test.ts
git commit -m "feat(schema): dispatcher with schemata → heuristic fallback"
```

---

## Task 10: `schema` command

**Files:**
- Create: `src/commands/schema.ts`
- Create: `tests/unit/commands/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/commands/schema.test.ts`:

```typescript
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

function seqHttp(responses: Array<{ status: number; body: string }>): { http: HttpClient; calls: number } {
  let i = 0;
  const wrap = { calls: 0 };
  const http: HttpClient = {
    send: vi.fn(async () => {
      wrap.calls++;
      return responses[i++];
    }),
  };
  return { http, calls: wrap.calls } as any;
}

describe("runSchema", () => {
  it("no arg: emits the catalog from /jsonapi root", async () => {
    const emitted: unknown[] = [];
    const warnings: string[] = [];
    const { http } = seqHttp([{ status: 200, body: rootIndexBody() }]);
    await runSchema(
      { target: undefined, operation: "create", refresh: false },
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
    const { http } = seqHttp([
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
    const { http } = seqHttp([]);
    await expect(runSchema(
      { target: "articleonly", operation: "create", refresh: false },
      { http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi", cwd: tempDir(), emit: () => {}, warn: () => {} },
    )).rejects.toBeInstanceOf(ValidationError);
  });

  it("--refresh bypasses the cache", async () => {
    // 1st call: schemata hit. 2nd call (same CLI invocation? no — we call runSchema twice)
    const body = JSON.stringify({ properties: { data: { type: "object" } } });
    const { http } = seqHttp([
      { status: 200, body },
      { status: 200, body },
    ]);
    const dir = tempDir();
    const deps = { http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi", cwd: dir, emit: () => {}, warn: () => {} };
    await runSchema({ target: "node/article", operation: "create", refresh: false }, deps);
    await runSchema({ target: "node/article", operation: "create", refresh: false }, deps); // cache hit
    await runSchema({ target: "node/article", operation: "create", refresh: true  }, deps); // cache bypass
    expect((http.send as any).mock.calls.length).toBe(2); // call 1 = first fetch; call 2 = --refresh fetch; second call served from cache
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/commands/schema.test.ts`
Expected: FAIL — `runSchema` not found.

- [ ] **Step 3: Write implementation**

Create `src/commands/schema.ts`:

```typescript
import { join } from "node:path";
import type { HttpClient } from "../core/http.js";
import type { AuthAdapter } from "../core/auth/types.js";
import { ValidationError } from "../errors.js";
import { fetchCatalog } from "../core/schema/catalog.js";
import { fetchJsonSchema, type SchemaSource } from "../core/schema/jsonschema-source.js";
import { toOperationVariant, type Operation } from "../core/schema/to-jsonschema.js";
import { createFileStore } from "../core/cache/file-store.js";

export interface SchemaArgs {
  target?: string;
  operation: Operation;
  refresh: boolean;
}

export interface SchemaDeps {
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  jsonapiPrefix: string;
  cwd: string;
  emit: (v: unknown) => void;
  warn: (m: string) => void;
}

const TARGET_RE = /^[a-z0-9_]+\/[a-z0-9_]+$/;

export async function runSchema(args: SchemaArgs, deps: SchemaDeps): Promise<void> {
  const store = createFileStore({ rootDir: join(deps.cwd, ".drupal-cli/cache"), warn: deps.warn });

  if (args.target === undefined) {
    if (!args.refresh) {
      const hit = await store.read<unknown>("catalog.json");
      if (hit !== undefined) {
        deps.emit(hit);
        return;
      }
    }
    const fresh = await fetchCatalog({ http: deps.http, auth: deps.auth, baseUrl: deps.baseUrl, jsonapiPrefix: deps.jsonapiPrefix });
    await store.write("catalog.json", fresh);
    deps.emit(fresh);
    return;
  }

  if (!TARGET_RE.test(args.target)) {
    throw new ValidationError(`target must be '<entity_type>/<bundle>', got '${args.target}'`);
  }
  const [entity, bundle] = args.target.split("/", 2);
  const cacheKey = `schema/${entity}--${bundle}.${args.operation}.json`;

  if (!args.refresh) {
    const hit = await store.read<unknown>(cacheKey);
    if (hit !== undefined) {
      deps.emit(hit);
      return;
    }
  }

  const { schema: raw, source } = await fetchJsonSchema({
    http: deps.http,
    auth: deps.auth,
    baseUrl: deps.baseUrl,
    jsonapiPrefix: deps.jsonapiPrefix,
    entity,
    bundle,
    warn: deps.warn,
  });
  const transformed = toOperationVariant(raw, args.operation);

  const tagged = {
    ...(transformed as Record<string, unknown>),
    "x-drupal-cli-source": source,
    "x-drupal-cli-target": { entity_type: entity, bundle },
    "x-drupal-cli-operation": args.operation,
  };

  await store.write(cacheKey, tagged);
  deps.emit(tagged);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/commands/schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/commands/schema.ts tests/unit/commands/schema.test.ts
git commit -m "feat(cli): schema command (catalog + per-target, hybrid source, cache)"
```

---

## Task 11: Register `schema` command in `src/index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add import**

At the top of `src/index.ts`, add:

```typescript
import { runSchema } from "./commands/schema.js";
```

- [ ] **Step 2: Register command**

After the existing `login` command registration and before `program.exitOverride()`, insert:

```typescript
  program
    .command("schema [target]")
    .description("Catalog (no target) or JSON Schema for <entity>/<bundle>")
    .option("--for <op>", "create|update", "create")
    .option("--refresh", "bypass cache for this call")
    .action((target: string | undefined, o: { for?: string; refresh?: boolean }) => {
      const operation = o.for === "update" ? "update" : "create";
      run((ctx) => runSchema(
        { target, operation, refresh: Boolean(o.refresh) },
        {
          http: ctx.http,
          auth: ctx.auth,
          baseUrl: ctx.baseUrl,
          jsonapiPrefix: ctx.jsonapiPrefix,
          cwd: ctx.cwd,
          emit: output.emit,
          warn: (m) => stderr(`${m}\n`),
        },
      ));
    });
```

- [ ] **Step 3: Typecheck and run all unit tests**

Run: `npm run typecheck && npx vitest run`
Expected: PASS (no regressions).

- [ ] **Step 4: Smoke-test the command manually**

Run: `npm run build && node bin/drupal-cli schema --help`
Expected: prints command usage with `[target]`, `--for`, `--refresh`.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(cli): wire schema command into program"
```

---

## Task 12: Integrate validator into `create`

**Files:**
- Modify: `src/commands/create.ts`
- Modify: `tests/unit/commands/create.test.ts`
- Modify: `src/index.ts` (add `--no-validate` flag)

- [ ] **Step 1: Extend create's test — add `--no-validate` path and validator hook**

Open `tests/unit/commands/create.test.ts`. Add these tests to the existing describe block (keep all existing tests):

```typescript
import { ValidationError } from "../../../src/errors.js";

// …existing tests…

it("validates payload against schema before posting", async () => {
  const validate = vi.fn();
  const c = client();
  const emitted: unknown[] = [];
  await runCreate(
    { entityType: "node", bundle: "article", dataArg: JSON.stringify({ data: { type: "node--article", attributes: { title: "ok" } } }) },
    { client: c, emit: (v) => emitted.push(v), validate },
  );
  expect(validate).toHaveBeenCalledWith(expect.anything(), "node/article");
  expect(c.post).toHaveBeenCalled();
});

it("throws ValidationError without posting when validator fails", async () => {
  const validate = vi.fn(() => { throw new ValidationError("bad", { errors: [{ message: "nope" }] }); });
  const c = client();
  await expect(runCreate(
    { entityType: "node", bundle: "article", dataArg: "{}" },
    { client: c, emit: () => {}, validate },
  )).rejects.toBeInstanceOf(ValidationError);
  expect(c.post).not.toHaveBeenCalled();
});

it("skips validation when noValidate=true", async () => {
  const validate = vi.fn(() => { throw new ValidationError("would fail"); });
  const c = client();
  await runCreate(
    { entityType: "node", bundle: "article", dataArg: "{}", noValidate: true },
    { client: c, emit: () => {}, validate },
  );
  expect(validate).not.toHaveBeenCalled();
  expect(c.post).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run tests/unit/commands/create.test.ts`
Expected: FAIL — `validate` is not part of `CreateDeps`.

- [ ] **Step 3: Extend `runCreate`**

Edit `src/commands/create.ts`:

```typescript
import type { JsonApiClient } from "../core/jsonapi/client.js";
import { readDataArg } from "./_data.js";

export interface CreateArgs {
  entityType: string;
  bundle: string;
  dataArg: string;
  dryRun?: boolean;
  noValidate?: boolean;
}
export interface CreateDeps {
  client: JsonApiClient;
  emit: (v: unknown) => void;
  validate?: (payload: unknown, target: string) => void;
}

export async function runCreate(args: CreateArgs, deps: CreateDeps): Promise<void> {
  const payload = await readDataArg(args.dataArg);
  const target = `${args.entityType}/${args.bundle}`;
  if (!args.noValidate && deps.validate) {
    deps.validate(payload, target);
  }
  if (args.dryRun) {
    deps.emit({ dry_run: true, method: "POST", path: target, payload });
    return;
  }
  const res = await deps.client.post(target, payload);
  deps.emit(res);
}
```

- [ ] **Step 4: Run the create tests**

Run: `npx vitest run tests/unit/commands/create.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Wire the real validator in `src/index.ts`**

At the top:

```typescript
import { validatePayload } from "./core/schema/validate.js";
import { runSchema } from "./commands/schema.js"; // already there after Task 11
import { createFileStore } from "./core/cache/file-store.js";
import { fetchJsonSchema } from "./core/schema/jsonschema-source.js";
import { toOperationVariant } from "./core/schema/to-jsonschema.js";
```

Add a helper (near the top-level of `buildProgram`, before `program.command(...)` registrations):

```typescript
  async function loadOrFetchSchema(ctx: CommandContext, target: string, op: "create" | "update"): Promise<unknown> {
    const store = createFileStore({ rootDir: `${ctx.cwd}/.drupal-cli/cache`, warn: (m) => stderr(`${m}\n`) });
    const [entity, bundle] = target.split("/", 2);
    const key = `schema/${entity}--${bundle}.${op}.json`;
    const hit = await store.read<unknown>(key);
    if (hit !== undefined) return hit;
    const { schema: raw, source } = await fetchJsonSchema({
      http: ctx.http, auth: ctx.auth, baseUrl: ctx.baseUrl, jsonapiPrefix: ctx.jsonapiPrefix,
      entity, bundle, warn: (m) => stderr(`${m}\n`),
    });
    const transformed = toOperationVariant(raw, op);
    const tagged = { ...(transformed as Record<string, unknown>), "x-drupal-cli-source": source, "x-drupal-cli-target": { entity_type: entity, bundle }, "x-drupal-cli-operation": op };
    await store.write(key, tagged);
    return tagged;
  }
```

Then modify the `create` command registration to support `--no-validate` and pass the validator:

```typescript
  program
    .command("create <entity_type>")
    .description("Create an entity of given type/bundle")
    .requiredOption("--bundle <bundle>")
    .requiredOption("--data <json>", "inline JSON or @path")
    .option("--dry-run")
    .option("--no-validate", "skip client-side schema validation")
    .action((entityType: string, o: { bundle: string; data: string; dryRun?: boolean; validate?: boolean }) => {
      const args: any = { entityType, bundle: o.bundle, dataArg: o.data };
      if (o.dryRun !== undefined) args.dryRun = o.dryRun;
      if (o.validate === false) args.noValidate = true;
      run(async (ctx) => {
        const deps: any = { client: ctx.client, emit: output.emit };
        if (!args.noValidate) {
          deps.validate = async (payload: unknown, target: string) => {
            const schema = await loadOrFetchSchema(ctx, target, "create");
            validatePayload(schema, payload, target);
          };
        }
        // Commander's .option("--no-validate") inverts so o.validate is true/false.
        await runCreate(args, deps);
      });
    });
```

Note: Commander treats `validate` as async but `CreateDeps.validate` is synchronous. Adjust the signature: change `validate?: (payload: unknown, target: string) => void` to `validate?: (payload: unknown, target: string) => void | Promise<void>` in `src/commands/create.ts`, and `await` it inside `runCreate`:

```typescript
if (!args.noValidate && deps.validate) {
  await deps.validate(payload, target);
}
```

- [ ] **Step 6: Run typecheck + all unit tests**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/commands/create.ts src/index.ts tests/unit/commands/create.test.ts
git commit -m "feat(create): client-side payload validation with --no-validate opt-out"
```

---

## Task 13: Integrate validator into `update`

**Files:**
- Modify: `src/commands/update.ts`
- Modify: `tests/unit/commands/update.test.ts`
- Modify: `src/index.ts`

Same shape as Task 12 but for update. Key difference: target is `entity/bundle/uuid` — we only validate against `entity/bundle`.

- [ ] **Step 1: Extend update tests**

Mirror the tests added in Task 12 for update: one passes validator in deps, one fails validation without PATCH, one opts out.

Open `tests/unit/commands/update.test.ts` and add (keeping existing tests intact):

```typescript
import { ValidationError } from "../../../src/errors.js";

it("validates payload against schema before patching", async () => {
  const validate = vi.fn();
  const c = client();
  await runUpdate(
    { target: "node/article/u1", dataArg: JSON.stringify({ data: { type: "node--article", id: "u1", attributes: { title: "new" } } }) },
    { client: c, emit: () => {}, validate },
  );
  expect(validate).toHaveBeenCalledWith(expect.anything(), "node/article");
  expect(c.patch).toHaveBeenCalled();
});

it("throws ValidationError without patching when validator fails", async () => {
  const validate = vi.fn(() => { throw new ValidationError("bad"); });
  const c = client();
  await expect(runUpdate(
    { target: "node/article/u1", dataArg: "{}" },
    { client: c, emit: () => {}, validate },
  )).rejects.toBeInstanceOf(ValidationError);
  expect(c.patch).not.toHaveBeenCalled();
});

it("skips validation when noValidate=true", async () => {
  const validate = vi.fn(() => { throw new ValidationError("would fail"); });
  const c = client();
  await runUpdate(
    { target: "node/article/u1", dataArg: "{}", noValidate: true },
    { client: c, emit: () => {}, validate },
  );
  expect(validate).not.toHaveBeenCalled();
  expect(c.patch).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run tests/unit/commands/update.test.ts`
Expected: FAIL on the new tests.

- [ ] **Step 3: Replace `src/commands/update.ts`**

```typescript
import type { JsonApiClient } from "../core/jsonapi/client.js";
import { ValidationError } from "../errors.js";
import { readDataArg } from "./_data.js";

export interface UpdateArgs {
  target: string;
  dataArg: string;
  dryRun?: boolean;
  noValidate?: boolean;
}
export interface UpdateDeps {
  client: JsonApiClient;
  emit: (v: unknown) => void;
  validate?: (payload: unknown, target: string) => void | Promise<void>;
}

const TARGET_RE = /^[a-z0-9_]+\/[a-z0-9_]+\/[a-f0-9-]{8,}$/;

export async function runUpdate(args: UpdateArgs, deps: UpdateDeps): Promise<void> {
  if (!TARGET_RE.test(args.target)) {
    throw new ValidationError(`target must be <entity_type>/<bundle>/<uuid>, got "${args.target}"`);
  }
  const payload = await readDataArg(args.dataArg);
  const [entity, bundle] = args.target.split("/", 3);
  const schemaTarget = `${entity}/${bundle}`;
  if (!args.noValidate && deps.validate) {
    await deps.validate(payload, schemaTarget);
  }
  if (args.dryRun) {
    deps.emit({ dry_run: true, method: "PATCH", path: args.target, payload });
    return;
  }
  const res = await deps.client.patch(args.target, payload);
  deps.emit(res);
}
```

- [ ] **Step 4: Update `src/index.ts` registration for update**

Add `--no-validate` flag and the validator wiring using the same `loadOrFetchSchema` helper from Task 12, with `op = "update"`:

```typescript
  program
    .command("update <target>")
    .description("Update an existing entity")
    .requiredOption("--data <json>", "inline JSON or @path")
    .option("--dry-run")
    .option("--no-validate", "skip client-side schema validation")
    .action((target: string, o: { data: string; dryRun?: boolean; validate?: boolean }) => {
      const args: any = { target, dataArg: o.data };
      if (o.dryRun !== undefined) args.dryRun = o.dryRun;
      if (o.validate === false) args.noValidate = true;
      run(async (ctx) => {
        const deps: any = { client: ctx.client, emit: output.emit };
        if (!args.noValidate) {
          deps.validate = async (payload: unknown, t: string) => {
            const schema = await loadOrFetchSchema(ctx, t, "update");
            validatePayload(schema, payload, t);
          };
        }
        await runUpdate(args, deps);
      });
    });
```

- [ ] **Step 5: Run typecheck + all unit tests**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/update.ts src/index.ts tests/unit/commands/update.test.ts
git commit -m "feat(update): client-side payload validation with --no-validate opt-out"
```

---

## Task 14: Baseline integration tests (no schemata setup)

**Files:**
- Create: `tests/integrations/schema/schema-list.integration.test.ts`
- Create: `tests/integrations/schema/schema-heuristic.integration.test.ts`
- Create: `tests/integrations/schema/schema-heuristic-empty-bundle.integration.test.ts`
- Create: `tests/integrations/schema/schema-refresh.integration.test.ts`
- Create: `tests/integrations/schema/schema-cache-persistence.integration.test.ts`
- Create: `tests/integrations/schema/schema-unknown-target.integration.test.ts`

Each test uses the existing `runCli` helper. The existing `drupal/` fixture has no schemata installed, so the `schema` command takes the heuristic path.

- [ ] **Step 1: Write `schema-list.integration.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { parseJson, runCli } from "../helpers/run.js";

describe("integration: schema (catalog)", () => {
  it("lists available targets with article_test and tags", async () => {
    const result = await runCli({ args: ["schema"] });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const list = parseJson<Array<{ entity_type: string; bundle: string; label: string }>>(result.stdout);
    expect(list.some((r) => r.entity_type === "node" && r.bundle === "article_test")).toBe(true);
    expect(list.some((r) => r.entity_type === "taxonomy_term" && r.bundle === "tags")).toBe(true);
  });
});
```

- [ ] **Step 2: Write `schema-heuristic.integration.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { parseJson, runCli, createTestNode } from "../helpers/run.js";

describe("integration: schema heuristic", () => {
  it("returns a heuristic schema and warns on stderr", async () => {
    // Ensure there is at least one node so the heuristic has a sample.
    await createTestNode(`heu-${crypto.randomUUID()}`);
    const result = await runCli({ args: ["schema", "node/article_test", "--refresh"] });
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/no 'schemata' module/);
    const schema = parseJson<{ [k: string]: unknown }>(result.stdout);
    expect(schema["x-drupal-cli-source"]).toBe("heuristic");
    expect(schema["x-drupal-cli-target"]).toEqual({ entity_type: "node", bundle: "article_test" });
    expect(schema["x-drupal-cli-operation"]).toBe("create");
  });
});
```

- [ ] **Step 3: Write `schema-heuristic-empty-bundle.integration.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { parseJson, runCli } from "../helpers/run.js";

describe("integration: schema heuristic empty bundle", () => {
  it("returns envelope-only schema for a bundle with no instances", async () => {
    // taxonomy_term--tags is typically empty in the fixture.
    const result = await runCli({ args: ["schema", "taxonomy_term/tags", "--refresh"] });
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/envelope-only/);
    const schema = parseJson<{ [k: string]: unknown }>(result.stdout);
    expect(schema["x-drupal-cli-source"]).toBe("heuristic-empty");
  });
});
```

If the fixture already contains tags, adjust to another known-empty bundle (find via `ddev drush eval ...` or accept that this test is skipped when the bundle has content).

- [ ] **Step 4: Write `schema-refresh.integration.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { rmSync, existsSync } from "node:fs";
import { parseJson, runCli, createTestNode } from "../helpers/run.js";

describe("integration: schema --refresh", () => {
  it("re-fetches when --refresh passed and serves cache otherwise", async () => {
    await createTestNode(`ref-${crypto.randomUUID()}`);
    // first call — populates cache
    const first = await runCli({ args: ["schema", "node/article_test"] });
    expect(first.code).toBe(0);
    const cacheDir = ".drupal-cli/cache/schema";
    expect(existsSync(`${cacheDir}/node--article_test.create.json`)).toBe(true);
    // second call — served from cache (no stderr warning because the dispatcher is not consulted)
    const second = await runCli({ args: ["schema", "node/article_test"] });
    expect(second.code).toBe(0);
    // third call — --refresh re-fetches
    const third = await runCli({ args: ["schema", "node/article_test", "--refresh"] });
    expect(third.code).toBe(0);
    expect(third.stderr).toMatch(/no 'schemata' module/);
    // cleanup to avoid test bleed
    rmSync(".drupal-cli", { recursive: true, force: true });
  });
});
```

- [ ] **Step 5: Write `schema-cache-persistence.integration.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { runCli, createTestNode } from "../helpers/run.js";

describe("integration: schema cache", () => {
  it("writes a cache file that is parseable JSON", async () => {
    await createTestNode(`cache-${crypto.randomUUID()}`);
    await runCli({ args: ["schema", "node/article_test", "--refresh"] });
    const path = ".drupal-cli/cache/schema/node--article_test.create.json";
    expect(existsSync(path)).toBe(true);
    const content = JSON.parse(readFileSync(path, "utf8"));
    expect(content["x-drupal-cli-operation"]).toBe("create");
    rmSync(".drupal-cli", { recursive: true, force: true });
  });
});
```

- [ ] **Step 6: Write `schema-unknown-target.integration.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { parseError, runCli } from "../helpers/run.js";

describe("integration: schema unknown target", () => {
  it("exits 4 with E_VALIDATION for an unknown bundle", async () => {
    const result = await runCli({ args: ["schema", "node/does_not_exist", "--refresh"] });
    expect(result.code).toBe(4);
    const err = parseError(result.stderr.split("\n").filter((l) => l.includes("E_VALIDATION"))[0] || result.stderr);
    expect(err.error.code).toBe("E_VALIDATION");
    expect(err.error.message).toMatch(/no such target/);
  });
});
```

Note: the stderr will contain a warning line (e.g., heuristic warning during the fallback attempt). Extract the JSON error line specifically — the helper `parseError` expects a single-line JSON payload.

- [ ] **Step 7: Run baseline integration tests**

Run: `npm run drupal:up && npm run test:integration -- schema`
Expected: all new `tests/integrations/schema/*.ts` tests PASS.

- [ ] **Step 8: Commit**

```bash
git add tests/integrations/schema
git commit -m "test(integration): baseline schema tests (heuristic path, cache, unknown target)"
```

---

## Task 15: Second DDEV fixture (`drupal-schemata/`)

**Files:**
- Create: `tests/integrations/drupal-schemata/composer.json` (copy of `drupal/composer.json` + `drupal/schemata`)
- Create: `tests/integrations/drupal-schemata/.ddev/config.yaml`
- Create: `tests/integrations/drupal-schemata/fixtures/*` (copies/adaptations of existing)
- Create: `tests/integrations/drupal-schemata/recipes/README.txt`
- Create: `tests/integrations/bin/drupal-schemata-up.sh`
- Create: `tests/integrations/bin/drupal-schemata-down.sh`
- Modify: `package.json` (add `drupal-schemata:up`/`drupal-schemata:down`)
- Modify: `tests/integrations/helpers/config.ts` + `run.ts` (second config path helpers)

- [ ] **Step 1: Copy the existing fixture**

Run:
```bash
cp -r tests/integrations/drupal tests/integrations/drupal-schemata
rm -f tests/integrations/drupal-schemata/.test-config.json
```

- [ ] **Step 2: Extend composer.json in the copy**

Edit `tests/integrations/drupal-schemata/composer.json` — add under `"require"`:

```json
"drupal/schemata": "^1.0"
```

Keep all other dependencies. The `schemata_json_schema` submodule ships inside `drupal/schemata`.

- [ ] **Step 3: Change the DDEV project name**

Edit `tests/integrations/drupal-schemata/.ddev/config.yaml` — set a distinct `name`:

```yaml
name: drupal-cli-test-schemata
```

(The up-script in Task 15 Step 5 will overwrite this with a hash-based project name to avoid collisions with the baseline fixture.)

- [ ] **Step 4: Create the boot script**

Create `tests/integrations/bin/drupal-schemata-up.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRUPAL_DIR="$ROOT/tests/integrations/drupal-schemata"

cd "$DRUPAL_DIR"

HASH="$(pwd | sha1sum | cut -c1-8)"
PROJECT_NAME="drupal-cli-test-schemata-${HASH}"

mkdir -p .ddev
printf 'name: %s\n' "$PROJECT_NAME" > .ddev/config.local.yaml

ddev start
ddev composer install --no-interaction

ddev drush site:install standard -y \
  --account-name=admin --account-pass=admin \
  --site-name="drupal-cli integration (schemata)"

ddev drush en -y basic_auth jsonapi simple_oauth simple_oauth_password_grant consumers schemata schemata_json_schema
ddev drush php:eval "\Drupal::configFactory()->getEditable('jsonapi.settings')->set('read_only', FALSE)->save();"

KEYDIR="/var/www/html/keys"
ddev exec bash -lc "mkdir -p '$KEYDIR' && openssl genrsa -out '$KEYDIR/private.key' 2048 && openssl rsa -in '$KEYDIR/private.key' -pubout -out '$KEYDIR/public.key' && chmod 600 '$KEYDIR/private.key' '$KEYDIR/public.key'"
ddev drush config:set -y simple_oauth.settings public_key "$KEYDIR/public.key"
ddev drush config:set -y simple_oauth.settings private_key "$KEYDIR/private.key"

ddev drush php:script fixtures/setup-content-type.php
ddev drush php:script fixtures/setup-users.php
OAUTH_OUTPUT="$(ddev drush php:script fixtures/setup-oauth.php)"
OAUTH_JSON="$(printf '%s\n' "$OAUTH_OUTPUT" | grep '^CONSUMER_JSON:' | head -1 | sed 's/^CONSUMER_JSON://')"
if [ -z "$OAUTH_JSON" ]; then
  echo "ERROR: setup-oauth.php did not print CONSUMER_JSON line" >&2
  exit 1
fi

URL="$(ddev describe -j | python3 -c 'import json, sys; print(json.load(sys.stdin)["raw"]["services"]["web"]["http_url"])')"

cat > .test-config.json <<EOF
{
  "url": "${URL}",
  "basic": { "user": "tester", "pass": "tester-pw" },
  "oauth2": $(printf '%s' "$OAUTH_JSON" | python3 -c '
import json, sys
data = json.load(sys.stdin)
data["user"] = "tester"
data["pass"] = "tester-pw"
print(json.dumps(data, indent=2))
')
}
EOF

echo
echo "Drupal (schemata) is up at ${URL}"
echo "Handover written to tests/integrations/drupal-schemata/.test-config.json"
```

Make it executable:
```bash
chmod +x tests/integrations/bin/drupal-schemata-up.sh
```

- [ ] **Step 5: Create teardown script**

Create `tests/integrations/bin/drupal-schemata-down.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRUPAL_DIR="$ROOT/tests/integrations/drupal-schemata"

cd "$DRUPAL_DIR"
ddev delete -Oy || true
rm -f .test-config.json .ddev/config.local.yaml
```

`chmod +x` as above.

- [ ] **Step 6: Add npm scripts**

Edit `package.json` to add:

```json
"drupal-schemata:up": "bash tests/integrations/bin/drupal-schemata-up.sh",
"drupal-schemata:down": "bash tests/integrations/bin/drupal-schemata-down.sh"
```

- [ ] **Step 7: Extend `tests/integrations/helpers/config.ts`**

Append to the file:

```typescript
export function testConfigSchemata(): TestConfig {
  const path = resolve("tests/integrations/drupal-schemata/.test-config.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TestConfig;
  } catch {
    throw new Error("Integration tests require the schemata DDEV fixture. Run: npm run drupal-schemata:up");
  }
}
```

- [ ] **Step 8: Extend `tests/integrations/helpers/run.ts` with `runCliSchemata`**

Add near the existing `runCli`:

```typescript
import { testConfigSchemata } from "./config.js";

export async function runCliSchemata(opts: RunOptions): Promise<RunResult> {
  const cfg = testConfigSchemata();
  const url = opts.url ?? cfg.url;
  const auth = opts.auth ?? { type: "basic", user: cfg.basic.user, pass: cfg.basic.pass } as Auth;
  const dir = mkdtempSync(join(tmpdir(), "drupal-cli-it-schemata-"));
  const cfgPath = join(dir, ".drupal-cli.yml");
  writeFileSync(cfgPath, renderConfig(url, auth), "utf8");

  return await new Promise<RunResult>((resolve) => {
    const child = spawn("node", ["bin/drupal-cli", ...opts.args], {
      env: { ...process.env, DRUPAL_CLI_CONFIG: cfgPath },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => { resolve({ code: code ?? -1, stdout, stderr }); });
  });
}
```

Note: `renderConfig` is already module-scoped; if it was function-local, factor it out.

- [ ] **Step 9: Boot the new fixture and verify**

Run: `npm run drupal-schemata:up`
Expected: finishes with `Drupal (schemata) is up at http://...`. Verify the handover file exists.

Smoke-check that schemata answers:
```bash
URL="$(python3 -c 'import json; print(json.load(open("tests/integrations/drupal-schemata/.test-config.json"))["url"])')"
curl -s -u tester:tester-pw "$URL/schemata/node/article_test?_format=schema_json&_describes=api_json" | head -c 200
```

Expected: JSON starting with `{"$schema":` or similar.

- [ ] **Step 10: Commit**

```bash
git add tests/integrations/drupal-schemata tests/integrations/bin/drupal-schemata-up.sh tests/integrations/bin/drupal-schemata-down.sh tests/integrations/helpers package.json
git commit -m "test(fixture): add drupal-schemata DDEV setup with schemata+schemata_json_schema"
```

---

## Task 16: Schemata-backed integration tests

**Files:**
- Create: `tests/integrations/schema/schema-jsonschema-create.integration.test.ts`
- Create: `tests/integrations/schema/schema-jsonschema-update.integration.test.ts`
- Create: `tests/integrations/schema/schema-validates-create-payload.integration.test.ts`

- [ ] **Step 1: Write `schema-jsonschema-create.integration.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import draft7 from "ajv/dist/refs/json-schema-draft-07.json" with { type: "json" };
import { parseJson, runCliSchemata } from "../helpers/run.js";

describe("integration: schema (schemata path, --for=create)", () => {
  it("returns a schemata-sourced schema that Ajv can compile", async () => {
    const result = await runCliSchemata({ args: ["schema", "node/article_test", "--refresh"] });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe(""); // no "no 'schemata' module" warning
    const schema = parseJson<any>(result.stdout);
    expect(schema["x-drupal-cli-source"]).toBe("schemata");
    const ajv = new Ajv({ allErrors: true, strict: false });
    ajv.addMetaSchema(draft7);
    const validate = ajv.compile(schema);
    // a valid payload passes
    const ok = {
      data: {
        type: "node--article_test",
        attributes: { title: "from-test" },
      },
    };
    expect(validate(ok)).toBe(true);
    // a payload missing title fails
    const bad = { data: { type: "node--article_test", attributes: {} } };
    expect(validate(bad)).toBe(false);
  });
});
```

- [ ] **Step 2: Write `schema-jsonschema-update.integration.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import draft7 from "ajv/dist/refs/json-schema-draft-07.json" with { type: "json" };
import { parseJson, runCliSchemata } from "../helpers/run.js";

describe("integration: schema (schemata path, --for=update)", () => {
  it("allows a partial payload when update variant is requested", async () => {
    const result = await runCliSchemata({ args: ["schema", "node/article_test", "--for=update", "--refresh"] });
    expect(result.code).toBe(0);
    const schema = parseJson<any>(result.stdout);
    expect(schema["x-drupal-cli-operation"]).toBe("update");
    const ajv = new Ajv({ allErrors: true, strict: false });
    ajv.addMetaSchema(draft7);
    const validate = ajv.compile(schema);
    // partial payload (no title, only body)
    const partial = {
      data: {
        type: "node--article_test",
        id: "00000000-0000-0000-0000-000000000000",
        attributes: { body: { value: "x", format: "plain_text" } },
      },
    };
    expect(validate(partial)).toBe(true);
  });
});
```

- [ ] **Step 3: Write `schema-validates-create-payload.integration.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseError, runCliSchemata } from "../helpers/run.js";

describe("integration: create validates payload client-side against schema", () => {
  it("rejects an invalid payload before hitting Drupal and reports E_VALIDATION (exit 4)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "drupal-cli-payload-"));
    const badFile = join(dir, "bad.json");
    writeFileSync(badFile, JSON.stringify({ data: { type: "node--article_test", attributes: {} } }));
    const result = await runCliSchemata({
      args: ["create", "node", "--bundle=article_test", `--data=@${badFile}`],
    });
    expect(result.code).toBe(4);
    const errLine = result.stderr.split("\n").find((l) => l.includes("E_VALIDATION")) ?? result.stderr;
    const err = parseError(errLine);
    expect(err.error.code).toBe("E_VALIDATION");
    expect(err.error.message).toMatch(/node\/article_test/);
    const errors = (err.error.details as any).errors as Array<{ instancePath: string }>;
    expect(errors.some((e) => e.instancePath.startsWith("/data/attributes"))).toBe(true);
  });

  it("--no-validate bypasses client-side check (server still rejects garbage)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "drupal-cli-payload-"));
    const badFile = join(dir, "bad.json");
    writeFileSync(badFile, JSON.stringify({ data: { type: "node--article_test", attributes: {} } }));
    const result = await runCliSchemata({
      args: ["create", "node", "--bundle=article_test", `--data=@${badFile}`, "--no-validate"],
    });
    // expect it to go to Drupal and come back with an HTTP 422 (exit 5)
    expect(result.code).toBe(5);
  });
});
```

- [ ] **Step 4: Run the schemata integration tests**

Run: `npm run test:integration -- tests/integrations/schema/schema-jsonschema- tests/integrations/schema/schema-validates-`
Expected: PASS.

- [ ] **Step 5: Run ALL tests (unit + baseline integration + schemata integration)**

Run:
```bash
npx vitest run
npm run test:integration
```

Expected: PASS across the board.

- [ ] **Step 6: Commit**

```bash
git add tests/integrations/schema/schema-jsonschema-create.integration.test.ts tests/integrations/schema/schema-jsonschema-update.integration.test.ts tests/integrations/schema/schema-validates-create-payload.integration.test.ts
git commit -m "test(integration): schemata-backed schema tests + create/update payload validation"
```

---

## Task 17: README + gitignore

**Files:**
- Modify: `README.md`
- Modify: `.gitignore`

- [ ] **Step 1: Add gitignore entry**

Append to `.gitignore`:
```
.drupal-cli/
```

- [ ] **Step 2: Add README section**

In `README.md` command reference section, add:

```markdown
### `drupal-cli schema [target]`

Without a target, prints the list of available `<entity_type>/<bundle>` targets on the site.

With a target (e.g. `node/article`), prints a JSON Schema document that validates a JSON:API request body for that resource.

- `--for=create` (default) / `--for=update` — operation variant
- `--refresh` — bypass the cache for this call

If the site has `drupal/schemata` + `drupal/schemata_json_schema` installed, the schema is authoritative (required fields, constraints). Otherwise, a shallow schema is returned with a warning (field names only, no required fields). The output carries `x-drupal-cli-source: "schemata" | "heuristic" | "heuristic-empty"`.

Schemas are cached under `.drupal-cli/cache/` next to your `.drupal-cli.yml`. Add `.drupal-cli/` to your `.gitignore`.

`drupal-cli create` and `drupal-cli update` run the payload through the same schema before sending it. Pass `--no-validate` to skip this step.
```

- [ ] **Step 3: Commit**

```bash
git add README.md .gitignore
git commit -m "docs: README + gitignore for schema command and cache"
```

---

## Self-review checklist (plan author)

- Spec §3 Command Surface — covered by Tasks 10, 11.
- Spec §4.1 Catalog — Task 6.
- Spec §4.2 Per-target hybrid — Tasks 7, 8, 9.
- Spec §4.3 Shallow schema — Task 8.
- Spec §4.4 Envelope-only skeleton — Task 8 (empty branch) + Task 9 (source tag).
- Spec §5 Output shape / vendor keys — Task 10.
- Spec §6 `--for=create|update` — Task 4.
- Spec §7 Errors table — Tasks 7, 9, 10 (ValidationError / HttpError throws) + existing error handler.
- Spec §8 Caching — Task 2 + Task 10.
- Spec §9 `create`/`update` integration + `--no-validate` — Tasks 12, 13.
- Spec §10 Module layout — matches the File Map above.
- Spec §11.1 Unit tests — all present.
- Spec §11.2 Fixtures — Tasks 3, 6, 7, 8.
- Spec §11.3 Integration tests + two DDEV setups — Tasks 14, 15, 16.
- Spec §11.4 TDD order — each task is TDD; dependency order matches the plan.
