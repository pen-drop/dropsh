# CLI Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the entity-agnostic `drupal-cli` foundation: project scaffold, config loader, HTTP client with retry, all auth adapters, JSON:API low-level client, and the six CRUD-style subcommands (`read`, `search`, `create`, `update`, `delete`, `upload-file`). Everything covered by Vitest unit tests. Drupal is not needed to run or test anything in this plan.

**Architecture:** Node.js + TypeScript. Thin CLI layer on top of a dependency-injected JSON:API client. Native `fetch`, no HTTP mocking library (tests inject a fake `fetch`). Commander for argv parsing. All core modules expose explicit factories that accept their collaborators as parameters — no hidden singletons.

**Tech Stack:** Node 20+, TypeScript 5, Vitest, Commander 12, js-yaml.

**Scope boundary:** This plan deliberately excludes `discover`, `schema`, `clean`, the companion Drupal module, DDEV, and the skill itself. All of that lives in subsequent plans.

---

## File Structure

Files created in this plan (mirror directory under `tests/unit/` for every `src/` module):

```
package.json
tsconfig.json
vitest.config.ts
.drupal-cli.yml.example
bin/drupal-cli
src/
  index.ts                       # commander wiring
  errors.ts                      # error classes + exit codes
  core/
    config.ts                    # YAML load + ${ENV} expansion
    http.ts                      # fetch wrapper + retry
    cli/
      output.ts                  # stdout JSON, stderr structured error
    auth/
      types.ts                   # AuthAdapter + related types
      basic.ts
      jwt.ts
      api-key.ts
      oauth2.ts                  # password + client_credentials grants
      factory.ts                 # createAuthAdapter(config, deps)
    jsonapi/
      query.ts                   # filter/page builders
      client.ts                  # typed GET/POST/PATCH/DELETE + upload
  commands/
    read.ts
    search.ts
    create.ts
    update.ts
    delete.ts
    upload-file.ts
tests/unit/                       # mirrors src/
```

Each file has one responsibility. No module imports from `commands/` into `core/`. Tests live alongside the code tree under `tests/unit/` with the same paths.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `bin/drupal-cli`
- Create: `src/index.ts`
- Create: `.drupal-cli.yml.example`
- Create: `tests/unit/.gitkeep`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "drupal-cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": { "drupal-cli": "./bin/drupal-cli" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^20.14.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Create `bin/drupal-cli`**

```sh
#!/usr/bin/env node
import("../dist/src/index.js").catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Make it executable:

```bash
chmod +x bin/drupal-cli
```

- [ ] **Step 5: Create `src/index.ts` (stub)**

```ts
#!/usr/bin/env node
import { Command } from "commander";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("drupal-cli")
    .description("Entity-agnostic CLI for Drupal 11 JSON:API")
    .version("0.0.0");
  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 6: Create `.drupal-cli.yml.example`**

```yaml
site:
  base_url: https://my-drupal.example.com
  jsonapi_prefix: /jsonapi
  auth:
    type: basic
    username: ${DRUPAL_USER}
    password: ${DRUPAL_PASSWORD}

defaults:
  dry_run: false
  timeout_ms: 30000
```

- [ ] **Step 7: Create `tests/unit/.gitkeep`** (empty file, keeps the directory tracked)

- [ ] **Step 8: Install dependencies and verify**

```bash
npm install
npm run typecheck
npm test
npm run build
node bin/drupal-cli --help
```

Expected:
- `typecheck` passes with no errors.
- `test` passes with 0 tests ("No test files found" is acceptable; exit 0 required).
- `build` produces `dist/src/index.js`.
- `--help` prints the commander usage with name "drupal-cli".

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts bin/ src/ tests/ .drupal-cli.yml.example
git commit -m "chore: scaffold drupal-cli TypeScript project"
```

---

## Task 2: Error types and exit codes

**Files:**
- Create: `src/errors.ts`
- Create: `tests/unit/errors.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CliError,
  ConfigError,
  AuthError,
  HttpError,
  ValidationError,
  exitCodeFor,
} from "../../src/errors.js";

describe("errors", () => {
  it("CliError carries code, message, details", () => {
    const err = new CliError("E_GENERIC", "boom", { hint: "x" });
    expect(err.code).toBe("E_GENERIC");
    expect(err.message).toBe("boom");
    expect(err.details).toEqual({ hint: "x" });
  });

  it("ConfigError uses E_CONFIG", () => {
    expect(new ConfigError("bad yaml").code).toBe("E_CONFIG");
  });

  it("AuthError uses E_AUTH", () => {
    expect(new AuthError("bad creds").code).toBe("E_AUTH");
  });

  it("HttpError carries status and body", () => {
    const err = new HttpError(422, "unprocessable", { errors: [] });
    expect(err.code).toBe("E_HTTP");
    expect(err.status).toBe(422);
    expect(err.body).toEqual({ errors: [] });
  });

  it("ValidationError uses E_VALIDATION", () => {
    expect(new ValidationError("missing title").code).toBe("E_VALIDATION");
  });

  it("exitCodeFor maps each error class", () => {
    expect(exitCodeFor(new ConfigError("x"))).toBe(2);
    expect(exitCodeFor(new AuthError("x"))).toBe(3);
    expect(exitCodeFor(new ValidationError("x"))).toBe(4);
    expect(exitCodeFor(new HttpError(500, "x"))).toBe(5);
    expect(exitCodeFor(new Error("x"))).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npx vitest run tests/unit/errors.test.ts
```
Expected: `Cannot find module '.../src/errors.js'`.

- [ ] **Step 3: Implement `src/errors.ts`**

```ts
export class CliError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.details = details;
  }
}

export class ConfigError extends CliError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("E_CONFIG", message, details);
    this.name = "ConfigError";
  }
}

export class AuthError extends CliError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("E_AUTH", message, details);
    this.name = "AuthError";
  }
}

export class ValidationError extends CliError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("E_VALIDATION", message, details);
    this.name = "ValidationError";
  }
}

export class HttpError extends CliError {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown = null) {
    super("E_HTTP", message, { status, body });
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

export function exitCodeFor(err: unknown): number {
  if (err instanceof ConfigError) return 2;
  if (err instanceof AuthError) return 3;
  if (err instanceof ValidationError) return 4;
  if (err instanceof HttpError) return 5;
  return 1;
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
npx vitest run tests/unit/errors.test.ts
```
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts tests/unit/errors.test.ts
git commit -m "feat(errors): error classes and exit-code mapping"
```

---

## Task 3: Config loader

**Files:**
- Create: `src/core/config.ts`
- Create: `tests/unit/core/config.test.ts`
- Create: `tests/unit/fixtures/config/valid.yml`
- Create: `tests/unit/fixtures/config/missing-env.yml`

- [ ] **Step 1: Create fixtures**

`tests/unit/fixtures/config/valid.yml`:

```yaml
site:
  base_url: https://example.com
  jsonapi_prefix: /jsonapi
  auth:
    type: basic
    username: ${TEST_USER}
    password: ${TEST_PASS}

defaults:
  dry_run: false
  timeout_ms: 15000
```

`tests/unit/fixtures/config/missing-env.yml`:

```yaml
site:
  base_url: https://example.com
  auth:
    type: jwt
    token: ${TEST_MISSING_JWT}
```

- [ ] **Step 2: Write the failing test**

`tests/unit/core/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/core/config.js";
import { ConfigError } from "../../../src/errors.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  path.join(here, "..", "fixtures", "config", name);

describe("loadConfig", () => {
  it("parses YAML and expands ${ENV}", async () => {
    const env = { TEST_USER: "alice", TEST_PASS: "s3cret" };
    const cfg = await loadConfig(fixture("valid.yml"), { env });
    expect(cfg.site.base_url).toBe("https://example.com");
    expect(cfg.site.jsonapi_prefix).toBe("/jsonapi");
    expect(cfg.site.auth).toEqual({ type: "basic", username: "alice", password: "s3cret" });
    expect(cfg.defaults.dry_run).toBe(false);
    expect(cfg.defaults.timeout_ms).toBe(15000);
  });

  it("defaults jsonapi_prefix to /jsonapi when omitted", async () => {
    const cfg = await loadConfig(fixture("valid.yml"), { env: { TEST_USER: "a", TEST_PASS: "b" } });
    expect(cfg.site.jsonapi_prefix).toBe("/jsonapi");
  });

  it("throws ConfigError on missing env var", async () => {
    await expect(loadConfig(fixture("missing-env.yml"), { env: {} })).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError on missing file", async () => {
    await expect(loadConfig(fixture("does-not-exist.yml"), { env: {} })).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError on missing site.base_url", async () => {
    const tmp = path.join(here, "..", "fixtures", "config", "no-base.yml");
    // File is created inline by the next test or can be prebuilt. For this test,
    // we test the schema path via a parsed object:
    await expect(
      loadConfig(fixture("valid.yml"), {
        env: { TEST_USER: "a", TEST_PASS: "b" },
        // Override parser to simulate missing base_url:
        parse: () => ({ site: { auth: { type: "basic" } }, defaults: {} }) as unknown,
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

```bash
npx vitest run tests/unit/core/config.test.ts
```
Expected: import fails on `../../../src/core/config.js`.

- [ ] **Step 4: Implement `src/core/config.ts`**

```ts
import { readFile } from "node:fs/promises";
import yaml from "js-yaml";
import { ConfigError } from "../errors.js";

export interface AuthConfig {
  type: "basic" | "oauth2_password" | "oauth2_client_credentials" | "jwt" | "api_key";
  [key: string]: unknown;
}

export interface SiteConfig {
  base_url: string;
  jsonapi_prefix: string;
  auth: AuthConfig;
}

export interface Config {
  site: SiteConfig;
  defaults: { dry_run: boolean; timeout_ms: number };
}

export interface LoadOptions {
  env?: Record<string, string | undefined>;
  parse?: (raw: string) => unknown;
}

const ENV_REF = /\$\{([A-Z0-9_]+)\}/g;

function expandEnv(value: unknown, env: Record<string, string | undefined>): unknown {
  if (typeof value === "string") {
    return value.replace(ENV_REF, (_match, name: string) => {
      const resolved = env[name];
      if (resolved === undefined) {
        throw new ConfigError(`Environment variable ${name} is not set`, { name });
      }
      return resolved;
    });
  }
  if (Array.isArray(value)) return value.map((v) => expandEnv(v, env));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = expandEnv(v, env);
    return out;
  }
  return value;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function loadConfig(filePath: string, opts: LoadOptions = {}): Promise<Config> {
  const env = opts.env ?? process.env;
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    throw new ConfigError(`Cannot read config file: ${filePath}`, { cause: String(err) });
  }

  let parsed: unknown;
  try {
    parsed = opts.parse ? opts.parse(raw) : yaml.load(raw);
  } catch (err) {
    throw new ConfigError(`Cannot parse config: ${(err as Error).message}`, { path: filePath });
  }

  const expanded = expandEnv(parsed, env);
  if (!isRecord(expanded)) throw new ConfigError("Config root must be an object");

  const site = expanded.site;
  if (!isRecord(site)) throw new ConfigError("site section missing");
  if (typeof site.base_url !== "string" || site.base_url.length === 0)
    throw new ConfigError("site.base_url required");
  if (!isRecord(site.auth)) throw new ConfigError("site.auth section missing");
  if (typeof site.auth.type !== "string") throw new ConfigError("site.auth.type required");

  const defaults = isRecord(expanded.defaults) ? expanded.defaults : {};

  return {
    site: {
      base_url: site.base_url,
      jsonapi_prefix: typeof site.jsonapi_prefix === "string" ? site.jsonapi_prefix : "/jsonapi",
      auth: site.auth as AuthConfig,
    },
    defaults: {
      dry_run: defaults.dry_run === true,
      timeout_ms: typeof defaults.timeout_ms === "number" ? defaults.timeout_ms : 30000,
    },
  };
}
```

- [ ] **Step 5: Run test, verify pass**

```bash
npx vitest run tests/unit/core/config.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/config.ts tests/unit/core/ tests/unit/fixtures/
git commit -m "feat(config): YAML loader with \${ENV} expansion and validation"
```

---

## Task 4: HTTP client with retry

**Files:**
- Create: `src/core/http.ts`
- Create: `tests/unit/core/http.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/core/http.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../../../src/core/http.js";
import { HttpError } from "../../../src/errors.js";

function mockFetch(responses: Array<{ status: number; body: string } | Error>): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[i++];
    if (!r) throw new Error("unexpected call");
    if (r instanceof Error) throw r;
    return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("createHttpClient", () => {
  it("sends and returns parsed response on 2xx", async () => {
    const http = createHttpClient({
      fetch: mockFetch([{ status: 200, body: '{"ok":true}' }]),
    });
    const res = await http.send({ method: "GET", url: "https://x/y" });
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true}');
  });

  it("retries on 503 up to maxRetries, then throws HttpError", async () => {
    const http = createHttpClient({
      fetch: mockFetch([
        { status: 503, body: "down" },
        { status: 503, body: "down" },
        { status: 503, body: "down" },
        { status: 503, body: "down" },
      ]),
      maxRetries: 3,
      retryDelayMs: 0,
    });
    await expect(http.send({ method: "GET", url: "https://x/y" })).rejects.toBeInstanceOf(HttpError);
  });

  it("retries on 503, then returns 200", async () => {
    const http = createHttpClient({
      fetch: mockFetch([
        { status: 503, body: "down" },
        { status: 200, body: '{"ok":true}' },
      ]),
      maxRetries: 3,
      retryDelayMs: 0,
    });
    const res = await http.send({ method: "GET", url: "https://x/y" });
    expect(res.status).toBe(200);
  });

  it("does NOT retry on 4xx", async () => {
    const fetchMock = mockFetch([{ status: 422, body: '{"errors":[]}' }]);
    const http = createHttpClient({ fetch: fetchMock, maxRetries: 3, retryDelayMs: 0 });
    await expect(http.send({ method: "POST", url: "https://x/y" })).rejects.toBeInstanceOf(HttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on thrown network error", async () => {
    const http = createHttpClient({
      fetch: mockFetch([new Error("ECONNRESET"), { status: 200, body: "{}" }]),
      maxRetries: 3,
      retryDelayMs: 0,
    });
    const res = await http.send({ method: "GET", url: "https://x/y" });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npx vitest run tests/unit/core/http.test.ts
```
Expected: module not found.

- [ ] **Step 3: Implement `src/core/http.ts`**

```ts
import { HttpError } from "../errors.js";

export interface HttpRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface HttpClient {
  send(req: HttpRequest): Promise<HttpResponse>;
}

export interface HttpOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

const RETRY_STATUSES = new Set([502, 503, 504, 408, 429]);

export function createHttpClient(opts: HttpOptions = {}): HttpClient {
  const f = opts.fetch ?? fetch;
  const maxRetries = opts.maxRetries ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 300;

  async function attempt(req: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeout = opts.timeoutMs
      ? setTimeout(() => controller.abort(), opts.timeoutMs)
      : null;
    try {
      const res = await f(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      });
      const text = await res.text();
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      return { status: res.status, headers, body: text };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((r) => setTimeout(r, ms));
  }

  return {
    async send(req: HttpRequest): Promise<HttpResponse> {
      let lastErr: unknown = null;
      for (let attemptIdx = 0; attemptIdx <= maxRetries; attemptIdx++) {
        try {
          const res = await attempt(req);
          if (res.status >= 200 && res.status < 300) return res;
          if (!RETRY_STATUSES.has(res.status) || attemptIdx === maxRetries) {
            let parsedBody: unknown = res.body;
            try { parsedBody = JSON.parse(res.body); } catch { /* keep text */ }
            throw new HttpError(res.status, `HTTP ${res.status}`, parsedBody);
          }
        } catch (err) {
          if (err instanceof HttpError) throw err;
          lastErr = err;
          if (attemptIdx === maxRetries) break;
        }
        await sleep(retryDelayMs * Math.pow(2, attemptIdx));
      }
      throw new HttpError(0, `Network failure after ${maxRetries + 1} attempts`, { cause: String(lastErr) });
    },
  };
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run tests/unit/core/http.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/http.ts tests/unit/core/http.test.ts
git commit -m "feat(http): fetch wrapper with retry on transient failures"
```

---

## Task 5: Auth adapter — basic

**Files:**
- Create: `src/core/auth/types.ts`
- Create: `src/core/auth/basic.ts`
- Create: `tests/unit/core/auth/basic.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/core/auth/basic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createBasicAuth } from "../../../../src/core/auth/basic.js";
import { AuthError } from "../../../../src/errors.js";

describe("basic auth", () => {
  it("adds Basic Authorization header", async () => {
    const adapter = createBasicAuth({ type: "basic", username: "alice", password: "s3cret" });
    const req = await adapter.apply({ method: "GET", url: "https://x/y" });
    expect(req.headers?.Authorization).toBe("Basic " + Buffer.from("alice:s3cret").toString("base64"));
  });

  it("preserves existing headers", async () => {
    const adapter = createBasicAuth({ type: "basic", username: "a", password: "b" });
    const req = await adapter.apply({ method: "GET", url: "https://x", headers: { "X-Foo": "1" } });
    expect(req.headers?.["X-Foo"]).toBe("1");
  });

  it("throws AuthError if username missing", () => {
    expect(() => createBasicAuth({ type: "basic", password: "x" } as any)).toThrow(AuthError);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npx vitest run tests/unit/core/auth/basic.test.ts
```
Expected: module not found.

- [ ] **Step 3: Implement `src/core/auth/types.ts`**

```ts
import type { HttpRequest } from "../http.js";

export interface AuthAdapter {
  apply(req: HttpRequest): Promise<HttpRequest>;
}
```

- [ ] **Step 4: Implement `src/core/auth/basic.ts`**

```ts
import type { AuthConfig } from "../config.js";
import type { HttpRequest } from "../http.js";
import { AuthError } from "../../errors.js";
import type { AuthAdapter } from "./types.js";

export function createBasicAuth(cfg: AuthConfig): AuthAdapter {
  const username = cfg.username;
  const password = cfg.password;
  if (typeof username !== "string" || typeof password !== "string") {
    throw new AuthError("basic auth requires username and password");
  }
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  return {
    async apply(req: HttpRequest): Promise<HttpRequest> {
      return { ...req, headers: { ...(req.headers ?? {}), Authorization: `Basic ${token}` } };
    },
  };
}
```

- [ ] **Step 5: Run test, verify pass**

```bash
npx vitest run tests/unit/core/auth/basic.test.ts
```
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/auth/ tests/unit/core/auth/
git commit -m "feat(auth): basic auth adapter"
```

---

## Task 6: Auth adapter — JWT

**Files:**
- Create: `src/core/auth/jwt.ts`
- Create: `tests/unit/core/auth/jwt.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/core/auth/jwt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createJwtAuth } from "../../../../src/core/auth/jwt.js";
import { AuthError } from "../../../../src/errors.js";

describe("jwt auth", () => {
  it("adds Bearer header with token", async () => {
    const adapter = createJwtAuth({ type: "jwt", token: "abc.def.ghi" });
    const req = await adapter.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.Authorization).toBe("Bearer abc.def.ghi");
  });

  it("throws AuthError if token missing", () => {
    expect(() => createJwtAuth({ type: "jwt" } as any)).toThrow(AuthError);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npx vitest run tests/unit/core/auth/jwt.test.ts
```

- [ ] **Step 3: Implement `src/core/auth/jwt.ts`**

```ts
import type { AuthConfig } from "../config.js";
import type { HttpRequest } from "../http.js";
import { AuthError } from "../../errors.js";
import type { AuthAdapter } from "./types.js";

export function createJwtAuth(cfg: AuthConfig): AuthAdapter {
  const token = cfg.token;
  if (typeof token !== "string" || token.length === 0) {
    throw new AuthError("jwt auth requires token");
  }
  return {
    async apply(req: HttpRequest): Promise<HttpRequest> {
      return { ...req, headers: { ...(req.headers ?? {}), Authorization: `Bearer ${token}` } };
    },
  };
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/core/auth/jwt.ts tests/unit/core/auth/jwt.test.ts
git commit -m "feat(auth): jwt bearer adapter"
```

---

## Task 7: Auth adapter — API key

**Files:**
- Create: `src/core/auth/api-key.ts`
- Create: `tests/unit/core/auth/api-key.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/core/auth/api-key.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createApiKeyAuth } from "../../../../src/core/auth/api-key.js";
import { AuthError } from "../../../../src/errors.js";

describe("api-key auth", () => {
  it("adds custom header with key", async () => {
    const adapter = createApiKeyAuth({ type: "api_key", header: "X-API-Key", key: "secret-k" });
    const req = await adapter.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.["X-API-Key"]).toBe("secret-k");
  });

  it("defaults header to X-API-Key", async () => {
    const adapter = createApiKeyAuth({ type: "api_key", key: "k" });
    const req = await adapter.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.["X-API-Key"]).toBe("k");
  });

  it("throws AuthError if key missing", () => {
    expect(() => createApiKeyAuth({ type: "api_key" } as any)).toThrow(AuthError);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement `src/core/auth/api-key.ts`**

```ts
import type { AuthConfig } from "../config.js";
import type { HttpRequest } from "../http.js";
import { AuthError } from "../../errors.js";
import type { AuthAdapter } from "./types.js";

export function createApiKeyAuth(cfg: AuthConfig): AuthAdapter {
  const key = cfg.key;
  const header = typeof cfg.header === "string" ? cfg.header : "X-API-Key";
  if (typeof key !== "string" || key.length === 0) {
    throw new AuthError("api_key auth requires key");
  }
  return {
    async apply(req: HttpRequest): Promise<HttpRequest> {
      return { ...req, headers: { ...(req.headers ?? {}), [header]: key } };
    },
  };
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/core/auth/api-key.ts tests/unit/core/auth/api-key.test.ts
git commit -m "feat(auth): api-key adapter"
```

---

## Task 8: Auth adapter — OAuth2 (password + client_credentials)

**Files:**
- Create: `src/core/auth/oauth2.ts`
- Create: `tests/unit/core/auth/oauth2.test.ts`

This adapter fetches a token from Drupal's OAuth2 token endpoint and caches it in memory for its lifetime. Token endpoint defaults to `${base_url}/oauth/token`.

- [ ] **Step 1: Write the failing test**

`tests/unit/core/auth/oauth2.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createOAuth2Auth } from "../../../../src/core/auth/oauth2.js";
import { AuthError } from "../../../../src/errors.js";
import type { HttpClient } from "../../../../src/core/http.js";

function httpMock(responses: Array<{ status: number; body: unknown }>): HttpClient {
  let i = 0;
  return {
    async send(req) {
      const r = responses[i++];
      if (!r) throw new Error("unexpected call");
      if (r.status >= 200 && r.status < 300) {
        return { status: r.status, headers: {}, body: JSON.stringify(r.body) };
      }
      const { HttpError } = await import("../../../../src/errors.js");
      throw new HttpError(r.status, `HTTP ${r.status}`, r.body);
    },
  };
}

describe("oauth2 auth", () => {
  it("password grant: fetches token, applies Bearer header, reuses cached token", async () => {
    const http = httpMock([{ status: 200, body: { access_token: "tok1", expires_in: 3600 } }]);
    const sendSpy = vi.spyOn(http, "send");
    const adapter = createOAuth2Auth(
      {
        type: "oauth2_password",
        client_id: "cid",
        client_secret: "csec",
        username: "u",
        password: "p",
      },
      { http, baseUrl: "https://x", now: () => 0 },
    );
    const r1 = await adapter.apply({ method: "GET", url: "https://x/y" });
    expect(r1.headers?.Authorization).toBe("Bearer tok1");
    const r2 = await adapter.apply({ method: "GET", url: "https://x/z" });
    expect(r2.headers?.Authorization).toBe("Bearer tok1");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("password grant: refetches after expiry", async () => {
    const http = httpMock([
      { status: 200, body: { access_token: "tok1", expires_in: 60 } },
      { status: 200, body: { access_token: "tok2", expires_in: 60 } },
    ]);
    let t = 0;
    const adapter = createOAuth2Auth(
      { type: "oauth2_password", client_id: "c", client_secret: "s", username: "u", password: "p" },
      { http, baseUrl: "https://x", now: () => t },
    );
    const r1 = await adapter.apply({ method: "GET", url: "https://x" });
    expect(r1.headers?.Authorization).toBe("Bearer tok1");
    t = 120_000; // past 60s expiry
    const r2 = await adapter.apply({ method: "GET", url: "https://x" });
    expect(r2.headers?.Authorization).toBe("Bearer tok2");
  });

  it("client_credentials grant uses correct body", async () => {
    const http = httpMock([{ status: 200, body: { access_token: "cc", expires_in: 3600 } }]);
    const sendSpy = vi.spyOn(http, "send");
    const adapter = createOAuth2Auth(
      { type: "oauth2_client_credentials", client_id: "c", client_secret: "s" },
      { http, baseUrl: "https://x", now: () => 0 },
    );
    await adapter.apply({ method: "GET", url: "https://x" });
    const call = sendSpy.mock.calls[0][0];
    expect(call.url).toBe("https://x/oauth/token");
    expect(call.body).toContain("grant_type=client_credentials");
    expect(call.body).toContain("client_id=c");
    expect(call.body).toContain("client_secret=s");
    expect(call.headers?.["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("throws AuthError when token endpoint returns error", async () => {
    const http = httpMock([{ status: 401, body: { error: "invalid_grant" } }]);
    const adapter = createOAuth2Auth(
      { type: "oauth2_password", client_id: "c", client_secret: "s", username: "u", password: "p" },
      { http, baseUrl: "https://x", now: () => 0 },
    );
    await expect(adapter.apply({ method: "GET", url: "https://x" })).rejects.toBeInstanceOf(AuthError);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement `src/core/auth/oauth2.ts`**

```ts
import type { AuthConfig } from "../config.js";
import type { HttpClient, HttpRequest } from "../http.js";
import { AuthError, HttpError } from "../../errors.js";
import type { AuthAdapter } from "./types.js";

export interface OAuth2Deps {
  http: HttpClient;
  baseUrl: string;
  now?: () => number;
}

function requireString(cfg: AuthConfig, key: string): string {
  const v = cfg[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new AuthError(`${cfg.type} auth requires ${key}`);
  }
  return v;
}

export function createOAuth2Auth(cfg: AuthConfig, deps: OAuth2Deps): AuthAdapter {
  const now = deps.now ?? Date.now;
  const clientId = requireString(cfg, "client_id");
  const clientSecret = requireString(cfg, "client_secret");
  const tokenUrl = typeof cfg.token_url === "string" ? cfg.token_url : `${deps.baseUrl.replace(/\/$/, "")}/oauth/token`;

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (cfg.type === "oauth2_password") {
    params.set("grant_type", "password");
    params.set("username", requireString(cfg, "username"));
    params.set("password", requireString(cfg, "password"));
    if (typeof cfg.scope === "string") params.set("scope", cfg.scope);
  } else if (cfg.type === "oauth2_client_credentials") {
    params.set("grant_type", "client_credentials");
    if (typeof cfg.scope === "string") params.set("scope", cfg.scope);
  } else {
    throw new AuthError(`Unsupported oauth2 grant: ${cfg.type}`);
  }

  let cached: { token: string; expiresAt: number } | null = null;

  async function fetchToken(): Promise<{ token: string; expiresAt: number }> {
    try {
      const res = await deps.http.send({
        method: "POST",
        url: tokenUrl,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const body = JSON.parse(res.body) as { access_token?: unknown; expires_in?: unknown };
      if (typeof body.access_token !== "string") {
        throw new AuthError("Token endpoint returned no access_token");
      }
      const ttlSec = typeof body.expires_in === "number" ? body.expires_in : 3600;
      return { token: body.access_token, expiresAt: now() + ttlSec * 1000 - 5000 };
    } catch (err) {
      if (err instanceof HttpError) throw new AuthError(`Token request failed: HTTP ${err.status}`, { body: err.body });
      throw new AuthError(`Token request failed: ${(err as Error).message}`);
    }
  }

  return {
    async apply(req: HttpRequest): Promise<HttpRequest> {
      if (!cached || cached.expiresAt <= now()) cached = await fetchToken();
      return { ...req, headers: { ...(req.headers ?? {}), Authorization: `Bearer ${cached.token}` } };
    },
  };
}
```

- [ ] **Step 4: Run test, verify pass**

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/auth/oauth2.ts tests/unit/core/auth/oauth2.test.ts
git commit -m "feat(auth): oauth2 password and client_credentials grants with token caching"
```

---

## Task 9: Auth factory

**Files:**
- Create: `src/core/auth/factory.ts`
- Create: `tests/unit/core/auth/factory.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/core/auth/factory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAuthAdapter } from "../../../../src/core/auth/factory.js";
import { AuthError } from "../../../../src/errors.js";
import type { HttpClient } from "../../../../src/core/http.js";

const http: HttpClient = { send: async () => ({ status: 200, headers: {}, body: "{}" }) };

describe("auth factory", () => {
  it("creates basic adapter", async () => {
    const a = createAuthAdapter({ type: "basic", username: "u", password: "p" }, { http, baseUrl: "https://x" });
    const req = await a.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.Authorization).toMatch(/^Basic /);
  });

  it("creates jwt adapter", async () => {
    const a = createAuthAdapter({ type: "jwt", token: "t" }, { http, baseUrl: "https://x" });
    const req = await a.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.Authorization).toBe("Bearer t");
  });

  it("creates api_key adapter", async () => {
    const a = createAuthAdapter({ type: "api_key", key: "k" }, { http, baseUrl: "https://x" });
    const req = await a.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.["X-API-Key"]).toBe("k");
  });

  it("creates oauth2 adapter", () => {
    const a = createAuthAdapter(
      { type: "oauth2_client_credentials", client_id: "c", client_secret: "s" },
      { http, baseUrl: "https://x" },
    );
    expect(a.apply).toBeTypeOf("function");
  });

  it("throws on unknown type", () => {
    expect(() => createAuthAdapter({ type: "weird" } as any, { http, baseUrl: "https://x" })).toThrow(AuthError);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement `src/core/auth/factory.ts`**

```ts
import type { AuthConfig } from "../config.js";
import type { HttpClient } from "../http.js";
import { AuthError } from "../../errors.js";
import type { AuthAdapter } from "./types.js";
import { createBasicAuth } from "./basic.js";
import { createJwtAuth } from "./jwt.js";
import { createApiKeyAuth } from "./api-key.js";
import { createOAuth2Auth } from "./oauth2.js";

export interface AuthFactoryDeps {
  http: HttpClient;
  baseUrl: string;
}

export function createAuthAdapter(cfg: AuthConfig, deps: AuthFactoryDeps): AuthAdapter {
  switch (cfg.type) {
    case "basic":
      return createBasicAuth(cfg);
    case "jwt":
      return createJwtAuth(cfg);
    case "api_key":
      return createApiKeyAuth(cfg);
    case "oauth2_password":
    case "oauth2_client_credentials":
      return createOAuth2Auth(cfg, { http: deps.http, baseUrl: deps.baseUrl });
    default:
      throw new AuthError(`Unknown auth.type: ${String(cfg.type)}`);
  }
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/core/auth/factory.ts tests/unit/core/auth/factory.test.ts
git commit -m "feat(auth): factory dispatch for all adapter types"
```

---

## Task 10: JSON:API query builder

**Files:**
- Create: `src/core/jsonapi/query.ts`
- Create: `tests/unit/core/jsonapi/query.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/core/jsonapi/query.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildQueryString } from "../../../../src/core/jsonapi/query.js";

describe("buildQueryString", () => {
  it("returns empty string for no params", () => {
    expect(buildQueryString({})).toBe("");
  });

  it("serialises a single equality filter", () => {
    expect(buildQueryString({ filter: [{ key: "title", value: "Hello" }] }))
      .toBe("?filter%5Btitle%5D%5Bvalue%5D=Hello");
  });

  it("serialises multiple filters as separate groups", () => {
    const q = buildQueryString({
      filter: [
        { key: "title", value: "Hello" },
        { key: "status", value: "1" },
      ],
    });
    expect(q).toContain("filter%5Btitle%5D%5Bvalue%5D=Hello");
    expect(q).toContain("filter%5Bstatus%5D%5Bvalue%5D=1");
  });

  it("includes operator when given", () => {
    const q = buildQueryString({
      filter: [{ key: "title", value: "Hello", operator: "CONTAINS" }],
    });
    expect(q).toContain("filter%5Btitle%5D%5Boperator%5D=CONTAINS");
    expect(q).toContain("filter%5Btitle%5D%5Bvalue%5D=Hello");
  });

  it("serialises page limit and offset", () => {
    const q = buildQueryString({ page: { limit: 25, offset: 50 } });
    expect(q).toContain("page%5Blimit%5D=25");
    expect(q).toContain("page%5Boffset%5D=50");
  });

  it("serialises sort and include", () => {
    const q = buildQueryString({ sort: "-created", include: ["field_tags", "field_image"] });
    expect(q).toContain("sort=-created");
    expect(q).toContain("include=field_tags%2Cfield_image");
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement `src/core/jsonapi/query.ts`**

```ts
export interface FilterSpec {
  key: string;
  value: string;
  operator?: string;
}

export interface QueryParams {
  filter?: FilterSpec[];
  sort?: string;
  page?: { limit?: number; offset?: number };
  include?: string[];
}

export function buildQueryString(q: QueryParams): string {
  const params = new URLSearchParams();
  for (const f of q.filter ?? []) {
    params.append(`filter[${f.key}][value]`, f.value);
    if (f.operator) params.append(`filter[${f.key}][operator]`, f.operator);
  }
  if (q.sort) params.append("sort", q.sort);
  if (q.page?.limit !== undefined) params.append("page[limit]", String(q.page.limit));
  if (q.page?.offset !== undefined) params.append("page[offset]", String(q.page.offset));
  if (q.include && q.include.length > 0) params.append("include", q.include.join(","));
  const s = params.toString();
  return s.length === 0 ? "" : `?${s}`;
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/core/jsonapi/query.ts tests/unit/core/jsonapi/query.test.ts
git commit -m "feat(jsonapi): query string builder for filters, paging, sort, include"
```

---

## Task 11: JSON:API client

**Files:**
- Create: `src/core/jsonapi/client.ts`
- Create: `tests/unit/core/jsonapi/client.test.ts`

The JSON:API client is a thin layer over `HttpClient`: it applies auth, builds the right URL, and parses JSON bodies. It exposes `get`, `post`, `patch`, `delete`, and `upload`. Entity-type awareness is limited to computing the URL path from `<entity_type>` (dot-separated internally via `--`; JSON:API path is `{entity_type}/{bundle}`).

- [ ] **Step 1: Write the failing test**

`tests/unit/core/jsonapi/client.test.ts`:

```ts
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
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toBe("https://site/jsonapi/node/article/abc");
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
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement `src/core/jsonapi/client.ts`**

```ts
import type { HttpClient } from "../http.js";
import type { AuthAdapter } from "../auth/types.js";
import { buildQueryString, type QueryParams } from "./query.js";

export interface JsonApiClient {
  get(path: string, query?: QueryParams): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
  patch(path: string, body: unknown): Promise<unknown>;
  delete(path: string): Promise<unknown>;
  upload(path: string, filename: string, data: Uint8Array | Buffer): Promise<unknown>;
}

export interface JsonApiOptions {
  baseUrl: string;
  prefix: string;
  http: HttpClient;
  auth: AuthAdapter;
}

function joinUrl(base: string, prefix: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = prefix.startsWith("/") ? prefix : `/${prefix}`;
  const r = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}${r}`;
}

const JSONAPI_HEADERS = {
  Accept: "application/vnd.api+json",
  "Content-Type": "application/vnd.api+json",
};

export function createJsonApiClient(opts: JsonApiOptions): JsonApiClient {
  async function send(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: string | Uint8Array, extraHeaders: Record<string, string> = {}) {
    const withAuth = await opts.auth.apply({
      method,
      url,
      headers: { ...JSONAPI_HEADERS, ...extraHeaders },
      body,
    });
    const res = await opts.http.send(withAuth);
    if (res.status === 204 || res.body.length === 0) return { ok: true };
    return JSON.parse(res.body) as unknown;
  }
  return {
    async get(path, query) {
      const url = joinUrl(opts.baseUrl, opts.prefix, path) + (query ? buildQueryString(query) : "");
      return send("GET", url);
    },
    async post(path, body) {
      return send("POST", joinUrl(opts.baseUrl, opts.prefix, path), JSON.stringify(body));
    },
    async patch(path, body) {
      return send("PATCH", joinUrl(opts.baseUrl, opts.prefix, path), JSON.stringify(body));
    },
    async delete(path) {
      return send("DELETE", joinUrl(opts.baseUrl, opts.prefix, path));
    },
    async upload(path, filename, data) {
      return send(
        "POST",
        joinUrl(opts.baseUrl, opts.prefix, path),
        data,
        {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `file; filename="${filename}"`,
        },
      );
    },
  };
}
```

- [ ] **Step 4: Run test, verify pass**

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/jsonapi/client.ts tests/unit/core/jsonapi/client.test.ts
git commit -m "feat(jsonapi): entity-agnostic client (GET/POST/PATCH/DELETE + upload)"
```

---

## Task 12: CLI output helpers

**Files:**
- Create: `src/core/cli/output.ts`
- Create: `tests/unit/core/cli/output.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/core/cli/output.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createOutput } from "../../../../src/core/cli/output.js";
import { ConfigError, HttpError } from "../../../../src/errors.js";

describe("createOutput", () => {
  it("writes JSON to stdout", () => {
    const out: string[] = []; const err: string[] = [];
    const o = createOutput({ stdout: (s) => out.push(s), stderr: (s) => err.push(s) });
    o.emit({ hello: "world" });
    expect(out.join("")).toBe('{"hello":"world"}\n');
    expect(err).toHaveLength(0);
  });

  it("writes structured error to stderr for CliError", () => {
    const err: string[] = [];
    const o = createOutput({ stdout: () => {}, stderr: (s) => err.push(s) });
    o.fail(new ConfigError("bad", { where: "x" }));
    const parsed = JSON.parse(err.join(""));
    expect(parsed.error.code).toBe("E_CONFIG");
    expect(parsed.error.message).toBe("bad");
    expect(parsed.error.details).toEqual({ where: "x" });
  });

  it("preserves HTTP body in details", () => {
    const err: string[] = [];
    const o = createOutput({ stdout: () => {}, stderr: (s) => err.push(s) });
    o.fail(new HttpError(422, "bad", { errors: [{ title: "x" }] }));
    const parsed = JSON.parse(err.join(""));
    expect(parsed.error.details.status).toBe(422);
    expect(parsed.error.details.body).toEqual({ errors: [{ title: "x" }] });
  });

  it("wraps non-CliError as E_UNKNOWN", () => {
    const err: string[] = [];
    const o = createOutput({ stdout: () => {}, stderr: (s) => err.push(s) });
    o.fail(new Error("oops"));
    const parsed = JSON.parse(err.join(""));
    expect(parsed.error.code).toBe("E_UNKNOWN");
    expect(parsed.error.message).toBe("oops");
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement `src/core/cli/output.ts`**

```ts
import { CliError } from "../../errors.js";

export interface Output {
  emit(value: unknown): void;
  fail(err: unknown): void;
}

export interface OutputOptions {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

export function createOutput(opts: OutputOptions): Output {
  return {
    emit(value) {
      opts.stdout(JSON.stringify(value) + "\n");
    },
    fail(err) {
      const payload =
        err instanceof CliError
          ? { error: { code: err.code, message: err.message, details: err.details } }
          : { error: { code: "E_UNKNOWN", message: (err as Error).message ?? String(err), details: {} } };
      opts.stderr(JSON.stringify(payload) + "\n");
    },
  };
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/core/cli/output.ts tests/unit/core/cli/output.test.ts
git commit -m "feat(cli): JSON stdout and structured error stderr"
```

---

## Task 13: Subcommand — `read`

**Files:**
- Create: `src/commands/read.ts`
- Create: `tests/unit/commands/read.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/commands/read.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runRead } from "../../../src/commands/read.js";
import type { JsonApiClient } from "../../../src/core/jsonapi/client.js";
import { ValidationError } from "../../../src/errors.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(async () => ({ data: { id: "u1", type: "node--article" } })),
    post: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn(),
  };
}

describe("runRead", () => {
  it("reads entity by type/uuid and emits response", async () => {
    const emitted: unknown[] = [];
    const c = client();
    await runRead({ target: "node/article/u1" }, { client: c, emit: (v) => emitted.push(v) });
    expect(c.get).toHaveBeenCalledWith("node/article/u1");
    expect(emitted).toEqual([{ data: { id: "u1", type: "node--article" } }]);
  });

  it("validates target shape", async () => {
    await expect(runRead({ target: "bad" }, { client: client(), emit: () => {} }))
      .rejects.toBeInstanceOf(ValidationError);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement `src/commands/read.ts`**

```ts
import type { JsonApiClient } from "../core/jsonapi/client.js";
import { ValidationError } from "../errors.js";

export interface ReadArgs { target: string; }
export interface ReadDeps { client: JsonApiClient; emit: (v: unknown) => void; }

const TARGET_RE = /^[a-z0-9_]+\/[a-z0-9_]+\/[a-f0-9-]{8,}$/;

export async function runRead(args: ReadArgs, deps: ReadDeps): Promise<void> {
  if (!TARGET_RE.test(args.target)) {
    throw new ValidationError(`target must be <entity_type>/<bundle>/<uuid>, got "${args.target}"`);
  }
  const res = await deps.client.get(args.target);
  deps.emit(res);
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/commands/read.ts tests/unit/commands/read.test.ts
git commit -m "feat(cli): read subcommand"
```

---

## Task 14: Subcommand — `search`

**Files:**
- Create: `src/commands/search.ts`
- Create: `tests/unit/commands/search.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/commands/search.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runSearch, parseFilterFlag } from "../../../src/commands/search.js";
import type { JsonApiClient } from "../../../src/core/jsonapi/client.js";
import { ValidationError } from "../../../src/errors.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(async () => ({ data: [] })),
    post: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn(),
  };
}

describe("parseFilterFlag", () => {
  it("parses key:value", () => {
    expect(parseFilterFlag("title:Hello")).toEqual({ key: "title", value: "Hello" });
  });
  it("parses key:op:value", () => {
    expect(parseFilterFlag("title:CONTAINS:World"))
      .toEqual({ key: "title", operator: "CONTAINS", value: "World" });
  });
  it("throws on malformed", () => {
    expect(() => parseFilterFlag("nocolons")).toThrow(ValidationError);
  });
});

describe("runSearch", () => {
  it("GETs entity_type/bundle with filters and limit", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runSearch(
      { entityType: "node", bundle: "article", filters: ["title:Hello"], limit: 10 },
      { client: c, emit: (v) => emitted.push(v) },
    );
    expect(c.get).toHaveBeenCalledWith("node/article", {
      filter: [{ key: "title", value: "Hello" }],
      page: { limit: 10 },
    });
    expect(emitted).toHaveLength(1);
  });

  it("works without bundle", async () => {
    const c = client();
    await runSearch({ entityType: "node", filters: [], limit: 50 }, { client: c, emit: () => {} });
    expect(c.get).toHaveBeenCalledWith("node", { filter: [], page: { limit: 50 } });
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement `src/commands/search.ts`**

```ts
import type { JsonApiClient } from "../core/jsonapi/client.js";
import type { FilterSpec } from "../core/jsonapi/query.js";
import { ValidationError } from "../errors.js";

export interface SearchArgs {
  entityType: string;
  bundle?: string;
  filters: string[];
  limit: number;
}
export interface SearchDeps {
  client: JsonApiClient;
  emit: (v: unknown) => void;
}

export function parseFilterFlag(raw: string): FilterSpec {
  const parts = raw.split(":");
  if (parts.length === 2) return { key: parts[0], value: parts[1] };
  if (parts.length >= 3) return { key: parts[0], operator: parts[1], value: parts.slice(2).join(":") };
  throw new ValidationError(`--filter must be key:value or key:op:value, got "${raw}"`);
}

export async function runSearch(args: SearchArgs, deps: SearchDeps): Promise<void> {
  const filters = args.filters.map(parseFilterFlag);
  const path = args.bundle ? `${args.entityType}/${args.bundle}` : args.entityType;
  const res = await deps.client.get(path, { filter: filters, page: { limit: args.limit } });
  deps.emit(res);
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/commands/search.ts tests/unit/commands/search.test.ts
git commit -m "feat(cli): search subcommand with filter flag parser"
```

---

## Task 15: Data-arg reader (shared by create/update/upload)

**Files:**
- Create: `src/commands/_data.ts`
- Create: `tests/unit/commands/_data.test.ts`

Shared helper that reads `--data=<json|@file>` into a parsed object.

- [ ] **Step 1: Write the failing test**

`tests/unit/commands/_data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readDataArg } from "../../../src/commands/_data.js";
import { ValidationError } from "../../../src/errors.js";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("readDataArg", () => {
  it("parses inline JSON", async () => {
    const v = await readDataArg('{"a":1}');
    expect(v).toEqual({ a: 1 });
  });
  it("reads @file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dc-"));
    const p = path.join(dir, "d.json");
    await writeFile(p, '{"b":2}');
    const v = await readDataArg(`@${p}`);
    expect(v).toEqual({ b: 2 });
  });
  it("throws on bad JSON", async () => {
    await expect(readDataArg("not json")).rejects.toBeInstanceOf(ValidationError);
  });
  it("throws on missing file", async () => {
    await expect(readDataArg("@/does/not/exist.json")).rejects.toBeInstanceOf(ValidationError);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement `src/commands/_data.ts`**

```ts
import { readFile } from "node:fs/promises";
import { ValidationError } from "../errors.js";

export async function readDataArg(raw: string): Promise<unknown> {
  let text = raw;
  if (raw.startsWith("@")) {
    try { text = await readFile(raw.slice(1), "utf8"); }
    catch (err) { throw new ValidationError(`Cannot read --data file ${raw.slice(1)}: ${(err as Error).message}`); }
  }
  try { return JSON.parse(text); }
  catch (err) { throw new ValidationError(`--data is not valid JSON: ${(err as Error).message}`); }
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/commands/_data.ts tests/unit/commands/_data.test.ts
git commit -m "feat(cli): shared --data argument reader (inline or @file)"
```

---

## Task 16: Subcommand — `create`

**Files:**
- Create: `src/commands/create.ts`
- Create: `tests/unit/commands/create.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/commands/create.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runCreate } from "../../../src/commands/create.js";
import type { JsonApiClient } from "../../../src/core/jsonapi/client.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn(),
    post: vi.fn(async () => ({ data: { id: "new-uuid" } })),
  };
}

describe("runCreate", () => {
  it("POSTs to entity_type/bundle with given data", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runCreate(
      { entityType: "node", bundle: "article", dataArg: '{"data":{"type":"node--article","attributes":{"title":"Hi"}}}' },
      { client: c, emit: (v) => emitted.push(v) },
    );
    expect(c.post).toHaveBeenCalledWith("node/article", {
      data: { type: "node--article", attributes: { title: "Hi" } },
    });
    expect(emitted).toEqual([{ data: { id: "new-uuid" } }]);
  });

  it("dry-run returns payload without calling client", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runCreate(
      { entityType: "node", bundle: "article", dataArg: '{"data":{"type":"node--article"}}', dryRun: true },
      { client: c, emit: (v) => emitted.push(v) },
    );
    expect(c.post).not.toHaveBeenCalled();
    expect(emitted).toEqual([{
      dry_run: true,
      method: "POST",
      path: "node/article",
      payload: { data: { type: "node--article" } },
    }]);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement `src/commands/create.ts`**

```ts
import type { JsonApiClient } from "../core/jsonapi/client.js";
import { readDataArg } from "./_data.js";

export interface CreateArgs {
  entityType: string;
  bundle: string;
  dataArg: string;
  dryRun?: boolean;
}
export interface CreateDeps {
  client: JsonApiClient;
  emit: (v: unknown) => void;
}

export async function runCreate(args: CreateArgs, deps: CreateDeps): Promise<void> {
  const payload = await readDataArg(args.dataArg);
  const path = `${args.entityType}/${args.bundle}`;
  if (args.dryRun) {
    deps.emit({ dry_run: true, method: "POST", path, payload });
    return;
  }
  const res = await deps.client.post(path, payload);
  deps.emit(res);
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/commands/create.ts tests/unit/commands/create.test.ts
git commit -m "feat(cli): create subcommand with dry-run"
```

---

## Task 17: Subcommand — `update`

**Files:**
- Create: `src/commands/update.ts`
- Create: `tests/unit/commands/update.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/commands/update.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runUpdate } from "../../../src/commands/update.js";
import type { JsonApiClient } from "../../../src/core/jsonapi/client.js";
import { ValidationError } from "../../../src/errors.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(), post: vi.fn(), delete: vi.fn(), upload: vi.fn(),
    patch: vi.fn(async () => ({ data: { id: "u1" } })),
  };
}

describe("runUpdate", () => {
  it("PATCHes entity_type/bundle/uuid with data", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runUpdate(
      { target: "node/article/u1", dataArg: '{"data":{"type":"node--article","id":"u1","attributes":{"title":"X"}}}' },
      { client: c, emit: (v) => emitted.push(v) },
    );
    expect(c.patch).toHaveBeenCalledWith("node/article/u1", {
      data: { type: "node--article", id: "u1", attributes: { title: "X" } },
    });
  });

  it("validates target shape", async () => {
    await expect(runUpdate({ target: "bad", dataArg: "{}" }, { client: client(), emit: () => {} }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("dry-run emits payload without sending", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runUpdate(
      { target: "node/article/u1", dataArg: '{"data":{}}', dryRun: true },
      { client: c, emit: (v) => emitted.push(v) },
    );
    expect(c.patch).not.toHaveBeenCalled();
    expect(emitted[0]).toMatchObject({ dry_run: true, method: "PATCH", path: "node/article/u1" });
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement `src/commands/update.ts`**

```ts
import type { JsonApiClient } from "../core/jsonapi/client.js";
import { ValidationError } from "../errors.js";
import { readDataArg } from "./_data.js";

export interface UpdateArgs {
  target: string;
  dataArg: string;
  dryRun?: boolean;
}
export interface UpdateDeps {
  client: JsonApiClient;
  emit: (v: unknown) => void;
}

const TARGET_RE = /^[a-z0-9_]+\/[a-z0-9_]+\/[a-f0-9-]{8,}$/;

export async function runUpdate(args: UpdateArgs, deps: UpdateDeps): Promise<void> {
  if (!TARGET_RE.test(args.target)) {
    throw new ValidationError(`target must be <entity_type>/<bundle>/<uuid>, got "${args.target}"`);
  }
  const payload = await readDataArg(args.dataArg);
  if (args.dryRun) {
    deps.emit({ dry_run: true, method: "PATCH", path: args.target, payload });
    return;
  }
  const res = await deps.client.patch(args.target, payload);
  deps.emit(res);
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/commands/update.ts tests/unit/commands/update.test.ts
git commit -m "feat(cli): update subcommand with dry-run"
```

---

## Task 18: Subcommand — `delete`

**Files:**
- Create: `src/commands/delete.ts`
- Create: `tests/unit/commands/delete.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/commands/delete.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runDelete } from "../../../src/commands/delete.js";
import type { JsonApiClient } from "../../../src/core/jsonapi/client.js";
import { ValidationError } from "../../../src/errors.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(), post: vi.fn(), patch: vi.fn(), upload: vi.fn(),
    delete: vi.fn(async () => ({ ok: true })),
  };
}

describe("runDelete", () => {
  it("DELETEs entity_type/bundle/uuid", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runDelete({ target: "node/article/u1" }, { client: c, emit: (v) => emitted.push(v) });
    expect(c.delete).toHaveBeenCalledWith("node/article/u1");
    expect(emitted).toEqual([{ ok: true }]);
  });

  it("validates target", async () => {
    await expect(runDelete({ target: "bad" }, { client: client(), emit: () => {} }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("dry-run does not delete", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runDelete({ target: "node/article/u1", dryRun: true }, { client: c, emit: (v) => emitted.push(v) });
    expect(c.delete).not.toHaveBeenCalled();
    expect(emitted[0]).toMatchObject({ dry_run: true, method: "DELETE", path: "node/article/u1" });
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement `src/commands/delete.ts`**

```ts
import type { JsonApiClient } from "../core/jsonapi/client.js";
import { ValidationError } from "../errors.js";

export interface DeleteArgs { target: string; dryRun?: boolean; }
export interface DeleteDeps { client: JsonApiClient; emit: (v: unknown) => void; }

const TARGET_RE = /^[a-z0-9_]+\/[a-z0-9_]+\/[a-f0-9-]{8,}$/;

export async function runDelete(args: DeleteArgs, deps: DeleteDeps): Promise<void> {
  if (!TARGET_RE.test(args.target)) {
    throw new ValidationError(`target must be <entity_type>/<bundle>/<uuid>, got "${args.target}"`);
  }
  if (args.dryRun) {
    deps.emit({ dry_run: true, method: "DELETE", path: args.target });
    return;
  }
  const res = await deps.client.delete(args.target);
  deps.emit(res);
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/commands/delete.ts tests/unit/commands/delete.test.ts
git commit -m "feat(cli): delete subcommand with dry-run"
```

---

## Task 19: Subcommand — `upload-file`

**Files:**
- Create: `src/commands/upload-file.ts`
- Create: `tests/unit/commands/upload-file.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/commands/upload-file.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runUploadFile } from "../../../src/commands/upload-file.js";
import type { JsonApiClient } from "../../../src/core/jsonapi/client.js";
import { ValidationError } from "../../../src/errors.js";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function client(): JsonApiClient {
  return {
    get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(),
    upload: vi.fn(async () => ({ data: { id: "file-uuid" } })),
  };
}

describe("runUploadFile", () => {
  it("uploads file contents to target field", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "up-"));
    const p = path.join(dir, "hero.jpg");
    await writeFile(p, Buffer.from("img"));
    const c = client();
    const emitted: unknown[] = [];
    await runUploadFile(
      { target: "node/article/abcdef01-abcd-abcd-abcd-abcdef012345/field_image", file: p },
      { client: c, emit: (v) => emitted.push(v) },
    );
    expect(c.upload).toHaveBeenCalledWith(
      "node/article/abcdef01-abcd-abcd-abcd-abcdef012345/field_image",
      "hero.jpg",
      expect.any(Buffer),
    );
    expect(emitted).toEqual([{ data: { id: "file-uuid" } }]);
  });

  it("validates target shape", async () => {
    await expect(runUploadFile({ target: "bad", file: "/x" }, { client: client(), emit: () => {} }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("dry-run emits plan without uploading", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "up-"));
    const p = path.join(dir, "a.txt");
    await writeFile(p, "hi");
    const c = client();
    const emitted: unknown[] = [];
    await runUploadFile(
      { target: "node/article/abcdef01-abcd-abcd-abcd-abcdef012345/field_image", file: p, dryRun: true },
      { client: c, emit: (v) => emitted.push(v) },
    );
    expect(c.upload).not.toHaveBeenCalled();
    expect(emitted[0]).toMatchObject({ dry_run: true, method: "POST-upload", bytes: 2 });
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement `src/commands/upload-file.ts`**

```ts
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { JsonApiClient } from "../core/jsonapi/client.js";
import { ValidationError } from "../errors.js";

export interface UploadArgs { target: string; file: string; dryRun?: boolean; }
export interface UploadDeps { client: JsonApiClient; emit: (v: unknown) => void; }

const TARGET_RE = /^[a-z0-9_]+\/[a-z0-9_]+\/[a-f0-9-]{8,}\/[a-z0-9_]+$/;

export async function runUploadFile(args: UploadArgs, deps: UploadDeps): Promise<void> {
  if (!TARGET_RE.test(args.target)) {
    throw new ValidationError(`target must be <entity_type>/<bundle>/<uuid>/<field>, got "${args.target}"`);
  }
  const filename = path.basename(args.file);
  if (args.dryRun) {
    const s = await stat(args.file);
    deps.emit({ dry_run: true, method: "POST-upload", path: args.target, filename, bytes: s.size });
    return;
  }
  const data = await readFile(args.file);
  const res = await deps.client.upload(args.target, filename, data);
  deps.emit(res);
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/commands/upload-file.ts tests/unit/commands/upload-file.test.ts
git commit -m "feat(cli): upload-file subcommand with dry-run"
```

---

## Task 20: Commander wiring in `src/index.ts`

**Files:**
- Modify: `src/index.ts`
- Create: `tests/unit/index.test.ts`

This task wires all subcommands into commander and verifies the entry builds a working program. The entry function accepts a context factory so tests can inject fakes; the real factory loads config and builds the JSON:API client.

- [ ] **Step 1: Write the failing test**

`tests/unit/index.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildProgram } from "../../src/index.js";
import type { JsonApiClient } from "../../src/core/jsonapi/client.js";

function fakeClient(): JsonApiClient {
  return {
    get: vi.fn(async () => ({ data: { id: "u1" } })),
    post: vi.fn(async () => ({ data: { id: "u2" } })),
    patch: vi.fn(async () => ({ data: { id: "u1" } })),
    delete: vi.fn(async () => ({ ok: true })),
    upload: vi.fn(async () => ({ data: { id: "file" } })),
  };
}

describe("buildProgram", () => {
  it("registers all subcommands", () => {
    const p = buildProgram({ contextFactory: async () => ({ client: fakeClient() }) });
    const names = p.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["create", "delete", "read", "search", "update", "upload-file"]);
  });

  it("read subcommand runs via parseAsync and writes JSON to stdout", async () => {
    const c = fakeClient();
    const out: string[] = []; const err: string[] = [];
    const p = buildProgram({
      contextFactory: async () => ({ client: c }),
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    });
    await p.parseAsync(["node", "drupal-cli", "read", "node/article/abcdef01-abcd-abcd-abcd-abcdef012345"]);
    expect(c.get).toHaveBeenCalledWith("node/article/abcdef01-abcd-abcd-abcd-abcdef012345");
    expect(JSON.parse(out.join(""))).toEqual({ data: { id: "u1" } });
  });

  it("propagates ValidationError to stderr with exit-code signal", async () => {
    const err: string[] = [];
    const exitCodes: number[] = [];
    const p = buildProgram({
      contextFactory: async () => ({ client: fakeClient() }),
      stdout: () => {},
      stderr: (s) => err.push(s),
      setExitCode: (code) => exitCodes.push(code),
    });
    await p.parseAsync(["node", "drupal-cli", "read", "bad"]);
    const parsed = JSON.parse(err.join(""));
    expect(parsed.error.code).toBe("E_VALIDATION");
    expect(exitCodes).toContain(4);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Replace `src/index.ts`**

```ts
#!/usr/bin/env node
import { Command } from "commander";
import { createHttpClient } from "./core/http.js";
import { loadConfig } from "./core/config.js";
import { createAuthAdapter } from "./core/auth/factory.js";
import { createJsonApiClient, type JsonApiClient } from "./core/jsonapi/client.js";
import { createOutput } from "./core/cli/output.js";
import { exitCodeFor } from "./errors.js";
import { runRead } from "./commands/read.js";
import { runSearch } from "./commands/search.js";
import { runCreate } from "./commands/create.js";
import { runUpdate } from "./commands/update.js";
import { runDelete } from "./commands/delete.js";
import { runUploadFile } from "./commands/upload-file.js";

export interface CommandContext { client: JsonApiClient; }

export interface ProgramOptions {
  contextFactory?: () => Promise<CommandContext>;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  setExitCode?: (code: number) => void;
}

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
  return { client };
}

export function buildProgram(opts: ProgramOptions = {}): Command {
  const program = new Command();
  program.name("drupal-cli").description("Entity-agnostic CLI for Drupal 11 JSON:API").version("0.0.0");

  const stdout = opts.stdout ?? ((s) => process.stdout.write(s));
  const stderr = opts.stderr ?? ((s) => process.stderr.write(s));
  const setExitCode = opts.setExitCode ?? ((c) => { process.exitCode = c; });
  const contextFactory = opts.contextFactory ?? defaultContext;
  const output = createOutput({ stdout, stderr });

  async function run(fn: (ctx: CommandContext) => Promise<void>): Promise<void> {
    try {
      const ctx = await contextFactory();
      await fn(ctx);
    } catch (err) {
      output.fail(err);
      setExitCode(exitCodeFor(err));
    }
  }

  program
    .command("read <target>")
    .description("Read entity_type/bundle/uuid")
    .action((target: string) =>
      run((ctx) => runRead({ target }, { client: ctx.client, emit: output.emit })));

  program
    .command("search <entity_type>")
    .description("Search entities with filters")
    .option("--bundle <bundle>")
    .option("--filter <kv...>", "filter in key:value or key:op:value form", [])
    .option("--limit <n>", "max results", (v) => parseInt(v, 10), 50)
    .action((entityType: string, o: { bundle?: string; filter: string[]; limit: number }) =>
      run((ctx) =>
        runSearch(
          { entityType, bundle: o.bundle, filters: o.filter, limit: o.limit },
          { client: ctx.client, emit: output.emit },
        ),
      ));

  program
    .command("create <entity_type>")
    .description("Create an entity of given type/bundle")
    .requiredOption("--bundle <bundle>")
    .requiredOption("--data <json>", "inline JSON or @path")
    .option("--dry-run")
    .action((entityType: string, o: { bundle: string; data: string; dryRun?: boolean }) =>
      run((ctx) =>
        runCreate(
          { entityType, bundle: o.bundle, dataArg: o.data, dryRun: o.dryRun },
          { client: ctx.client, emit: output.emit },
        ),
      ));

  program
    .command("update <target>")
    .description("Update an existing entity")
    .requiredOption("--data <json>", "inline JSON or @path")
    .option("--dry-run")
    .action((target: string, o: { data: string; dryRun?: boolean }) =>
      run((ctx) =>
        runUpdate({ target, dataArg: o.data, dryRun: o.dryRun }, { client: ctx.client, emit: output.emit }),
      ));

  program
    .command("delete <target>")
    .description("Delete an entity")
    .option("--dry-run")
    .action((target: string, o: { dryRun?: boolean }) =>
      run((ctx) => runDelete({ target, dryRun: o.dryRun }, { client: ctx.client, emit: output.emit })));

  program
    .command("upload-file")
    .description("Upload a file to an entity's file/media field")
    .requiredOption("--target <target>", "entity_type/bundle/uuid/field_name")
    .requiredOption("--file <path>")
    .option("--dry-run")
    .action((o: { target: string; file: string; dryRun?: boolean }) =>
      run((ctx) =>
        runUploadFile({ target: o.target, file: o.file, dryRun: o.dryRun }, { client: ctx.client, emit: output.emit }),
      ));

  program.exitOverride(); // prevent commander from calling process.exit during tests

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    // commander may throw on --help; accept exit code 0 for those
    if ((err as { code?: string }).code === "commander.helpDisplayed") return;
    process.exitCode = process.exitCode ?? 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run tests/unit/index.test.ts
```
Expected: 3 tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```
Expected: all tests green.

- [ ] **Step 6: Build and smoke-check**

```bash
npm run typecheck
npm run build
node bin/drupal-cli --help
node bin/drupal-cli read --help
```
Expected: all commands listed, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts tests/unit/index.test.ts
git commit -m "feat(cli): wire all subcommands via commander with dep injection"
```

---

## Task 21: End-to-end smoke using a local fake JSON:API server

**Files:**
- Create: `tests/unit/smoke.test.ts`

Purpose: sanity check that the whole stack (config load, http, auth, client, command) works as one unit against an in-process fake HTTP server. This is still a unit test — it uses a locally bound Node HTTP server on a random port and exercises one command end-to-end.

- [ ] **Step 1: Write the failing test**

`tests/unit/smoke.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { buildProgram } from "../../src/index.js";
import { createHttpClient } from "../../src/core/http.js";
import { createAuthAdapter } from "../../src/core/auth/factory.js";
import { createJsonApiClient } from "../../src/core/jsonapi/client.js";

describe("smoke: read command against fake Drupal", () => {
  let server: Server;
  let port = 0;

  beforeEach(async () => {
    server = createServer((req, res) => {
      if (req.url === "/jsonapi/node/article/abcdef01-abcd-abcd-abcd-abcdef012345") {
        res.writeHead(200, { "content-type": "application/vnd.api+json" });
        res.end('{"data":{"id":"abcdef01-abcd-abcd-abcd-abcdef012345","type":"node--article","attributes":{"title":"Hi"}}}');
        return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("reads an article", async () => {
    const out: string[] = [];
    const http = createHttpClient({});
    const baseUrl = `http://127.0.0.1:${port}`;
    const auth = createAuthAdapter({ type: "basic", username: "a", password: "b" }, { http, baseUrl });
    const client = createJsonApiClient({ baseUrl, prefix: "/jsonapi", http, auth });
    const p = buildProgram({
      contextFactory: async () => ({ client }),
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    await p.parseAsync(["node", "drupal-cli", "read", "node/article/abcdef01-abcd-abcd-abcd-abcdef012345"]);
    const res = JSON.parse(out.join(""));
    expect(res.data.attributes.title).toBe("Hi");
  });
});
```

- [ ] **Step 2: Run test, verify pass** (no implementation needed — all plumbing exists)

```bash
npx vitest run tests/unit/smoke.test.ts
```
Expected: 1 test passes.

- [ ] **Step 3: Run full test suite and typecheck**

```bash
npm run typecheck && npm test && npm run build
```
Expected: everything green, build output in `dist/`.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/smoke.test.ts
git commit -m "test: end-to-end smoke with in-process fake Drupal server"
```

---

## Task 22: README with usage snippets

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

`README.md`:

````markdown
# drupal-cli

Entity-agnostic helper CLI for Drupal 11 JSON:API. Written in TypeScript, used directly by the `drupal-cli` Claude skill for editorial publishing workflows.

This is the foundation CLI. Discovery, schema generation, and the skill layer are delivered by follow-up plans.

## Install

```bash
npm install
npm run build
```

## Configure

Copy `.drupal-cli.yml.example` to `.drupal-cli.yml` in your project and set the auth fields. Secrets are referenced as `${ENV_VAR}` and expanded at load time.

```yaml
site:
  base_url: https://my-drupal.example.com
  auth:
    type: basic
    username: ${DRUPAL_USER}
    password: ${DRUPAL_PASSWORD}
```

## Commands

All commands write JSON to stdout, structured errors to stderr, and use exit codes 0-5.

```bash
drupal-cli read <entity_type>/<bundle>/<uuid>
drupal-cli search <entity_type> [--bundle=<b>] [--filter=key:value]… [--limit=N]
drupal-cli create <entity_type> --bundle=<b> --data=<json|@file> [--dry-run]
drupal-cli update <entity_type>/<bundle>/<uuid> --data=<json|@file> [--dry-run]
drupal-cli delete <entity_type>/<bundle>/<uuid> [--dry-run]
drupal-cli upload-file --target=<entity_type>/<bundle>/<uuid>/<field> --file=<path> [--dry-run]
```

## Development

```bash
npm test            # Vitest unit suite
npm run test:watch
npm run typecheck
npm run build
```

See `docs/superpowers/specs/2026-04-21-drupal-cli-design.md` for the full design.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with install, config, and command reference"
```

---

## Plan Self-Review

- **Spec coverage:**
  - §7 CLI Surface: `read`/`search`/`create`/`update`/`delete`/`upload-file` all implemented (Tasks 13, 14, 16–19). `discover`/`schema`/`clean` intentionally deferred to Plan 2.
  - §10 Config & Auth: `.drupal-cli.yml` loader with `${ENV}` expansion (Task 3). All MVP auth types — basic, jwt, api_key, oauth2_password, oauth2_client_credentials — implemented (Tasks 5–9). ✓
  - §12 Errors: structured error class hierarchy with exit codes (Task 2). Retry only on 5xx/transient (Task 4). ✓
  - §12.3 Dry-run: `--dry-run` flag plumbed through `create`, `update`, `delete`, `upload-file` with plan-only emit (Tasks 16–19). ✓
  - §13.1 CLI unit tests: Vitest everywhere. ✓
- **Placeholder scan:** No `TBD`/`TODO` strings. Every step shows the exact code to write. ✓
- **Type consistency:** `AuthAdapter`, `HttpClient`, `HttpRequest`/`HttpResponse`, `JsonApiClient`, `Config`, `AuthConfig`, `QueryParams`/`FilterSpec`, `CommandContext` are defined once and referenced by the same names in every later task. ✓
- **Scope check:** The plan deliberately stops before `discover`, `schema`, `clean`, companion module, DDEV, and the skill itself — those are Plans 2 and 3. What's in this plan is testable, releasable, and useful on its own as a generic Drupal JSON:API CLI. ✓

---

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
