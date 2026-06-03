# Auth Provider Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the first-wins single `AuthAdapter` with a provider-registry auth system — `dropsh auth login` shows a picker of login-capable providers, stores one active session in the state dir, and `auth logout` / `auth status` operate on that session.

**Architecture:** A focused `AuthProvider` interface (`login`/`logout`/`status`/`createAdapter`) lives in core. Providers come from `config.plugins` via a new optional `authProvider` field on `DropSHPlugin`. A core session store persists exactly one `{ activeProvider, session }` per host in `~/.config/dropsh/<host>.json`. The thin `AuthAdapter.apply()` survives as the runtime piece returned by `createAdapter`. Non-secret connection params stay in config; secrets/tokens are interactive at login and stored in the state dir.

**Tech Stack:** Node.js 20+, TypeScript (ESM, `.js` import specifiers), Commander, Vitest, pnpm workspace. The oauth2 provider ships in `@dropsh/plugin-oauth2`; basic auth is core.

**Conventions (match existing code):**
- Tests use Vitest `describe`/`it`/`expect`; temp dirs via `mkdtemp(join(tmpdir(), "dropsh-test-"))`.
- Run a single test file: `pnpm vitest run <path>`. Run all unit tests: `pnpm test`.
- Plugin source imports core via `dropsh/plugin` (mapped to `src/plugin-api.ts`).
- Errors: `AuthError` (exit 3), `ConfigError` (exit 2) from `src/errors.ts`.
- Before each commit the repo gate is `pnpm run lint && pnpm run typecheck && pnpm test`.

**Transition strategy:** New code is added additively (Tasks 1–8). `pnpm run lint && pnpm run typecheck && pnpm test` stays green after **every** task — unit tests build the program with a stubbed `contextFactory`, so they never exercise the runtime auth resolver. Note: end-to-end CLI auth on a real config is intentionally non-functional between Task 6 (basic drops its legacy `createAuthAdapter`) and Task 9 (runtime switches to session resolution); this window is invisible to the test suite and is closed by Task 9. Execute Tasks 6→9 in one sitting. Legacy interface/types are removed in Task 10.

---

### Task 1: AuthProvider types

**Files:**
- Modify: `src/core/auth/types.ts`
- Test: `tests/unit/core/auth/types.test.ts` (create)

- [ ] **Step 1: Write the failing test**

The types are compile-time only, so the test asserts a hand-written object satisfies the interfaces (a type-level smoke test that also documents the shapes).

```ts
// tests/unit/core/auth/types.test.ts
import { describe, expect, it } from "vitest";
import type { AuthContext, AuthProvider, AuthSession, AuthStatusInfo } from "../../../../src/core/auth/types.js";

describe("auth types", () => {
  it("a minimal provider satisfies AuthProvider", () => {
    const session: AuthSession = { access_token: "x", expires_at: 1 };
    const provider: AuthProvider = {
      id: "fake",
      displayName: "Fake",
      capabilities: { login: true, logout: true, status: true },
      async login(_ctx: AuthContext) {
        return session;
      },
      async logout() {},
      async status(s): Promise<AuthStatusInfo> {
        return { loggedIn: s !== null };
      },
      createAdapter() {
        return { async apply(req) { return req; } };
      },
    };
    expect(provider.id).toBe("fake");
    expect(provider.capabilities.login).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/core/auth/types.test.ts`
Expected: FAIL — `AuthProvider`/`AuthContext`/`AuthSession`/`AuthStatusInfo` are not exported from `types.ts`.

- [ ] **Step 3: Add the types**

Replace `src/core/auth/types.ts` with:

```ts
import type { HttpClient, HttpRequest } from "../http.js";

export interface AuthAdapter {
  apply(req: HttpRequest): Promise<HttpRequest>;
}

/** Provider-specific opaque session payload persisted to the state dir. */
export type AuthSession = Record<string, unknown>;

export interface AuthStatusInfo {
  loggedIn: boolean;
  provider?: string;
  host?: string;
  expiresAt?: number;
  state?: "valid" | "expired";
}

/** I/O the core supplies to a provider during login/logout so providers stay testable. */
export interface AuthContext {
  baseUrl: string;
  http: HttpClient;
  /** State dir override (tests). Undefined → provider uses the default (~/.config/dropsh). */
  stateDir?: string;
  prompt(opts: { label: string; secret?: boolean }): Promise<string>;
  openBrowser(url: string): Promise<void>;
  stdout(s: string): void;
  now(): number;
}

/** Runtime helpers handed to createAdapter so a provider can refresh + persist its session. */
export interface AdapterRuntime {
  http: HttpClient;
  now(): number;
  /** Persist a refreshed session back to the active session slot. */
  save(session: AuthSession): Promise<void>;
}

export interface AuthProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: { login: boolean; logout: boolean; status: boolean };
  login(ctx: AuthContext): Promise<AuthSession>;
  logout(ctx: AuthContext): Promise<void>;
  status(session: AuthSession | null): Promise<AuthStatusInfo>;
  createAdapter(session: AuthSession, rt: AdapterRuntime): AuthAdapter;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/core/auth/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/auth/types.ts tests/unit/core/auth/types.test.ts
git commit -m "feat(auth): add AuthProvider/AuthContext/AuthSession types"
```

---

### Task 2: Session store

Generalises the oauth2 token-store into a core single-session store keyed per host.

**Files:**
- Create: `src/core/auth/session-store.ts`
- Test: `tests/unit/core/auth/session-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/auth/session-store.test.ts
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clearSession, readSession, writeSession } from "../../../../src/core/auth/session-store.js";

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));
  await fn(dir);
}

describe("session-store", () => {
  it("returns null when no session file exists", async () => {
    await withTmpDir(async (dir) => {
      expect(await readSession("https://example.com", dir)).toBeNull();
    });
  });

  it("round-trips a written session", async () => {
    await withTmpDir(async (dir) => {
      await writeSession("https://example.com", "oauth2_authcode", { access_token: "a", expires_at: 9 }, dir);
      const rec = await readSession("https://example.com", dir);
      expect(rec).toEqual({ activeProvider: "oauth2_authcode", session: { access_token: "a", expires_at: 9 } });
    });
  });

  it("writes the session file with 0600 permissions", async () => {
    await withTmpDir(async (dir) => {
      await writeSession("https://example.com", "basic", { basic_b64: "x" }, dir);
      const info = await stat(join(dir, "example.com.json"));
      expect(info.mode & 0o777).toBe(0o600);
    });
  });

  it("uses hostname as filename, ignoring path and port", async () => {
    await withTmpDir(async (dir) => {
      await writeSession("https://my.site.org:8080/x", "basic", { basic_b64: "y" }, dir);
      const rec = await readSession("https://my.site.org:9999/other", dir);
      expect(rec?.session).toEqual({ basic_b64: "y" });
    });
  });

  it("clearSession removes the active session", async () => {
    await withTmpDir(async (dir) => {
      await writeSession("https://example.com", "basic", { basic_b64: "x" }, dir);
      await clearSession("https://example.com", dir);
      expect(await readSession("https://example.com", dir)).toBeNull();
    });
  });

  it("clearSession on a missing session is a no-op", async () => {
    await withTmpDir(async (dir) => {
      await clearSession("https://example.com", dir);
      expect(await readSession("https://example.com", dir)).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/core/auth/session-store.test.ts`
Expected: FAIL — module `session-store.js` not found.

- [ ] **Step 3: Implement the session store**

```ts
// src/core/auth/session-store.ts
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AuthSession } from "./types.js";

export interface SessionRecord {
  activeProvider: string;
  session: AuthSession;
}

export function defaultStateDir(): string {
  return join(homedir(), ".config", "dropsh");
}

function hostnameFromUrl(baseUrl: string): string {
  return new URL(baseUrl).hostname;
}

function sessionPath(baseUrl: string, dir: string): string {
  return join(dir, `${hostnameFromUrl(baseUrl)}.json`);
}

export async function readSession(baseUrl: string, dir?: string): Promise<SessionRecord | null> {
  const path = sessionPath(baseUrl, dir ?? defaultStateDir());
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
}

export async function writeSession(
  baseUrl: string,
  activeProvider: string,
  session: AuthSession,
  dir?: string,
): Promise<void> {
  const stateDir = dir ?? defaultStateDir();
  await mkdir(stateDir, { recursive: true });
  const record: SessionRecord = { activeProvider, session };
  await writeFile(sessionPath(baseUrl, stateDir), JSON.stringify(record, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function clearSession(baseUrl: string, dir?: string): Promise<void> {
  await rm(sessionPath(baseUrl, dir ?? defaultStateDir()), { force: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/core/auth/session-store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/auth/session-store.ts tests/unit/core/auth/session-store.test.ts
git commit -m "feat(auth): add per-host single-session store"
```

---

### Task 3: Interactive prompt helper

A small injectable prompt for terminals. Providers receive `ctx.prompt`; the default reads a line from stdin (hidden for secrets).

**Files:**
- Create: `src/core/cli/prompt.ts`
- Test: `tests/unit/core/cli/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

The default prompt reads from a provided stream so it is testable without a real TTY.

```ts
// tests/unit/core/cli/prompt.test.ts
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createPrompt } from "../../../../src/core/cli/prompt.js";

describe("createPrompt", () => {
  it("reads a line of input and strips the newline", async () => {
    const input = new PassThrough();
    const out: string[] = [];
    const prompt = createPrompt({ input, write: (s) => out.push(s) });
    const p = prompt({ label: "Username" });
    input.write("admin\n");
    expect(await p).toBe("admin");
    expect(out.join("")).toContain("Username");
  });

  it("does not echo the label suffix differently for secrets but still resolves", async () => {
    const input = new PassThrough();
    const prompt = createPrompt({ input, write: () => {} });
    const p = prompt({ label: "Password", secret: true });
    input.write("hunter2\n");
    expect(await p).toBe("hunter2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/core/cli/prompt.test.ts`
Expected: FAIL — module `prompt.js` not found.

- [ ] **Step 3: Implement the prompt helper**

```ts
// src/core/cli/prompt.ts
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

export interface PromptDeps {
  input?: Readable;
  write?: (s: string) => void;
  /** TTY check override (tests). Defaults to input.isTTY. */
  isTTY?: boolean;
}

export type PromptFn = (opts: { label: string; secret?: boolean }) => Promise<string>;

/**
 * Build a prompt function. Secret prompts use raw mode + manual key
 * accumulation on a real TTY so the input is never echoed. On a non-TTY
 * stream (tests/pipes) input is read as a line so the value is still captured.
 */
export function createPrompt(deps: PromptDeps = {}): PromptFn {
  const input = deps.input ?? process.stdin;
  const write = deps.write ?? ((s: string) => process.stderr.write(s));
  const isTTY = deps.isTTY ?? Boolean((input as NodeJS.ReadStream).isTTY);

  return ({ label, secret }) =>
    new Promise<string>((resolve, reject) => {
      write(`${label}: `);

      if (secret && isTTY) {
        const stdin = input as NodeJS.ReadStream;
        const prevRaw = stdin.isRaw === true;
        let buf = "";
        stdin.setRawMode?.(true);
        stdin.resume();
        const cleanup = (): void => {
          stdin.setRawMode?.(prevRaw);
          stdin.pause();
          stdin.off("data", onData);
        };
        const onData = (d: Buffer): void => {
          for (const ch of d.toString("utf8")) {
            if (ch === "\n" || ch === "\r") {
              cleanup();
              write("\n");
              resolve(buf);
              return;
            }
            if (ch === "\u0003") {
              cleanup();
              reject(new Error("input cancelled"));
              return;
            }
            if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
            else buf += ch;
          }
        };
        stdin.on("data", onData);
        return;
      }

      // Non-secret, or non-TTY (tests/pipes): read a single line.
      const rl = createInterface({ input });
      rl.once("line", (line) => {
        rl.close();
        resolve(line.replace(/\r?\n$/, ""));
      });
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/core/cli/prompt.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/cli/prompt.ts tests/unit/core/cli/prompt.test.ts
git commit -m "feat(cli): add injectable interactive prompt helper"
```

---

### Task 4: Add `authProvider` to DropSHPlugin

Done before the registry so the registry test compiles against a real field.

**Files:**
- Modify: `src/core/plugin.ts`
- Test: `tests/unit/core/plugin.test.ts` (extend if present; otherwise create)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/plugin.test.ts
import { describe, expect, it } from "vitest";
import type { DropSHPlugin } from "../../../src/core/plugin.js";

describe("DropSHPlugin", () => {
  it("allows an optional authProvider field", () => {
    const plugin: DropSHPlugin = {
      id: "x",
      requiredModules: [],
      authProvider: {
        id: "x",
        displayName: "X",
        capabilities: { login: true, logout: true, status: true },
        async login() { return {}; },
        async logout() {},
        async status() { return { loggedIn: false }; },
        createAdapter() { return { async apply(r) { return r; } }; },
      },
      async extendSchema(_e, _b, s) { return s; },
    };
    expect(plugin.authProvider?.id).toBe("x");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/core/plugin.test.ts`
Expected: FAIL — `authProvider` is not a known property of `DropSHPlugin`.

- [ ] **Step 3: Add the field (keep `createAuthAdapter` for now)**

In `src/core/plugin.ts` add the import and the field. Keep `createAuthAdapter?` until Task 10 so the legacy path still compiles.

```ts
import type { AuthAdapter, AuthProvider } from "./auth/types.js";
```

Inside `interface DropSHPlugin`, add after `createAuthAdapter?(): AuthAdapter;`:

```ts
  /** New provider-based auth. Preferred over createAuthAdapter (legacy). */
  authProvider?: AuthProvider;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/core/plugin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/plugin.ts tests/unit/core/plugin.test.ts
git commit -m "feat(auth): add optional authProvider field to DropSHPlugin"
```

---

### Task 5: Provider registry

Collects `AuthProvider`s from the plugin list and resolves the login-capable set / a provider by id. Depends on the `authProvider` field added in Task 4, so it compiles cleanly.

**Files:**
- Create: `src/core/auth/registry.ts`
- Test: `tests/unit/core/auth/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/auth/registry.test.ts
import { describe, expect, it } from "vitest";
import { collectProviders, loginCapableProviders, providerById } from "../../../../src/core/auth/registry.js";
import type { AuthProvider } from "../../../../src/core/auth/types.js";
import type { DropSHPlugin } from "../../../../src/core/plugin.js";

function fakeProvider(id: string, login: boolean): AuthProvider {
  return {
    id,
    displayName: id.toUpperCase(),
    capabilities: { login, logout: true, status: true },
    async login() { return {}; },
    async logout() {},
    async status() { return { loggedIn: false }; },
    createAdapter() { return { async apply(r) { return r; } }; },
  };
}

function pluginWith(provider?: AuthProvider): DropSHPlugin {
  return {
    id: provider?.id ?? "noauth",
    requiredModules: [],
    ...(provider ? { authProvider: provider } : {}),
    async extendSchema(_e, _b, s) { return s; },
  };
}

describe("provider registry", () => {
  it("collects only plugins that carry an authProvider", () => {
    const p1 = fakeProvider("basic", true);
    const providers = collectProviders([pluginWith(p1), pluginWith()]);
    expect(providers.map((p) => p.id)).toEqual(["basic"]);
  });

  it("loginCapableProviders filters by capabilities.login", () => {
    const providers = [fakeProvider("a", true), fakeProvider("b", false)];
    expect(loginCapableProviders(providers).map((p) => p.id)).toEqual(["a"]);
  });

  it("providerById finds a provider or returns undefined", () => {
    const providers = [fakeProvider("a", true)];
    expect(providerById(providers, "a")?.id).toBe("a");
    expect(providerById(providers, "missing")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/core/auth/registry.test.ts`
Expected: FAIL — module `registry.js` not found.

- [ ] **Step 3: Implement the registry**

```ts
// src/core/auth/registry.ts
import type { DropSHPlugin } from "../plugin.js";
import type { AuthProvider } from "./types.js";

export function collectProviders(plugins: DropSHPlugin[]): AuthProvider[] {
  return plugins.map((p) => p.authProvider).filter((p): p is AuthProvider => p !== undefined);
}

export function loginCapableProviders(providers: AuthProvider[]): AuthProvider[] {
  return providers.filter((p) => p.capabilities.login);
}

export function providerById(providers: AuthProvider[], id: string): AuthProvider | undefined {
  return providers.find((p) => p.id === id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/core/auth/registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/auth/registry.ts tests/unit/core/auth/registry.test.ts
git commit -m "feat(auth): add provider registry helpers"
```

---

### Task 6: Basic auth provider

`basicAuthPlugin()` gains an `authProvider`. `login` prompts username + password, stores `{ basic_b64 }`. `createAdapter` sets the `Authorization: Basic` header from the session. Username may be pre-seeded from config (optional); password is always prompted.

**Files:**
- Modify: `src/core/auth/basic.ts`
- Test: `tests/unit/core/auth/basic.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
// add to tests/unit/core/auth/basic.test.ts
import { describe, expect, it } from "vitest";
import { basicAuthPlugin } from "../../../../src/core/auth/basic.js";
import type { AuthContext } from "../../../../src/core/auth/types.js";

function fakeCtx(answers: Record<string, string>): AuthContext {
  return {
    baseUrl: "https://example.com",
    http: { async send() { throw new Error("unused"); } },
    async prompt({ label }) { return answers[label] ?? ""; },
    async openBrowser() {},
    stdout() {},
    now() { return 0; },
  };
}

describe("basic auth provider", () => {
  it("login prompts username + password and yields a base64 session", async () => {
    const provider = basicAuthPlugin().authProvider!;
    const session = await provider.login(fakeCtx({ Username: "admin", Password: "secret" }));
    expect(session).toEqual({ basic_b64: Buffer.from("admin:secret").toString("base64") });
  });

  it("createAdapter applies the Authorization header", async () => {
    const provider = basicAuthPlugin().authProvider!;
    const b64 = Buffer.from("u:p").toString("base64");
    const adapter = provider.createAdapter({ basic_b64: b64 }, {
      http: { async send() { throw new Error("unused"); } },
      now: () => 0,
      async save() {},
    });
    const req = await adapter.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.Authorization).toBe(`Basic ${b64}`);
  });

  it("status reports loggedIn based on the session presence", async () => {
    const provider = basicAuthPlugin().authProvider!;
    expect((await provider.status(null)).loggedIn).toBe(false);
    expect((await provider.status({ basic_b64: "x" })).loggedIn).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/core/auth/basic.test.ts`
Expected: FAIL — `basicAuthPlugin()` requires a config argument and has no `authProvider`.

- [ ] **Step 3: Implement the basic provider**

Replace `src/core/auth/basic.ts` with:

```ts
import { ConfigError } from "../../errors.js";
import type { HttpRequest } from "../http.js";
import type { DropSHPlugin } from "../plugin.js";
import type { AuthAdapter, AuthProvider, AuthSession } from "./types.js";

export interface BasicAuthConfig {
  /** Optional pre-seeded username; password is always prompted at login. */
  username?: string;
}

function adapterFromB64(b64: string): AuthAdapter {
  return {
    async apply(req: HttpRequest): Promise<HttpRequest> {
      return { ...req, headers: { ...(req.headers ?? {}), Authorization: `Basic ${b64}` } };
    },
  };
}

export function basicAuthProvider(config: BasicAuthConfig = {}): AuthProvider {
  return {
    id: "basic",
    displayName: "Basic auth (username / password)",
    capabilities: { login: true, logout: true, status: true },
    async login(ctx): Promise<AuthSession> {
      const username = config.username ?? (await ctx.prompt({ label: "Username" }));
      if (!username) throw new ConfigError("basic auth: username required");
      const password = await ctx.prompt({ label: "Password", secret: true });
      if (!password) throw new ConfigError("basic auth: password required");
      return { basic_b64: Buffer.from(`${username}:${password}`).toString("base64") };
    },
    async logout() {
      // No server-side revoke for basic auth; the core clears the session.
    },
    async status(session) {
      return { loggedIn: session !== null, provider: "basic" };
    },
    createAdapter(session): AuthAdapter {
      const b64 = session.basic_b64;
      if (typeof b64 !== "string") throw new ConfigError("basic auth: corrupt session");
      return adapterFromB64(b64);
    },
  };
}

export function basicAuthPlugin(config: BasicAuthConfig = {}): DropSHPlugin {
  return {
    id: "basic",
    requiredModules: [],
    authProvider: basicAuthProvider(config),
    async extendSchema(_entityType, _bundle, schema, _ctx) {
      return schema;
    },
  };
}
```

> NOTE: this drops the legacy `createBasicAuth`/`createAuthAdapter` export. Any test importing `createBasicAuth` is updated in Task 10; until then, search `rg createBasicAuth` and if a unit test references it, temporarily keep a re-export `export { basicAuthProvider as createBasicAuth }` — but prefer fixing in Task 10. If the legacy `tests/unit/core/auth/basic.test.ts` cases assert the old `createBasicAuth` shape, replace them with the three cases above in this step.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/core/auth/basic.test.ts`
Expected: PASS (3 cases above).

- [ ] **Step 5: Commit**

```bash
git add src/core/auth/basic.ts tests/unit/core/auth/basic.test.ts
git commit -m "feat(auth): convert basic auth to AuthProvider with interactive login"
```

---

### Task 7: OAuth2 auth provider

Convert `oauth2Plugin(config)` to expose one `AuthProvider` whose flow depends on `config.type`. Reuse the existing PKCE browser logic and token-exchange logic, but return/consume `AuthSession` and use the core session store via `ctx`/`rt`.

**Files:**
- Create: `plugins/oauth2/src/provider.ts`
- Modify: `plugins/oauth2/src/index.ts`
- Modify: `plugins/oauth2/src/login.ts` (extract a session-returning exchange)
- Test: `plugins/oauth2/tests/unit/provider.test.ts`
- Export from core: `src/plugin-api.ts` (add session/types exports — see Task 8 Step 3 list; add the two it needs here)

- [ ] **Step 1: Export the new core symbols the plugin imports**

The plugin imports core via `dropsh/plugin`. Add to `src/plugin-api.ts`:

```ts
export type { AdapterRuntime, AuthContext, AuthProvider, AuthSession, AuthStatusInfo } from "./core/auth/types.js";
```

Run: `pnpm run typecheck` — Expected: PASS (additive exports).

- [ ] **Step 2: Extract a session-returning auth-code exchange**

In `plugins/oauth2/src/login.ts`, add a new exported function that performs the browser+PKCE exchange and **returns** the session instead of writing the token store. Keep `runLogin` temporarily (removed in Task 10).

```ts
// append to plugins/oauth2/src/login.ts
import type { AuthSession } from "dropsh/plugin";

export interface AcquireAuthCodeDeps {
  baseUrl: string;
  clientId: string;
  tokenUrl: string;
  scope?: string;
  redirectPort?: number;
  http: HttpClient;
  openBrowser: (url: string) => Promise<void>;
  stdout: (s: string) => void;
  now: () => number;
  timeoutMs?: number;
  _generatePkce?: () => { verifier: string; challenge: string };
  _generateState?: () => string;
}

/** Runs the PKCE browser flow and returns an AuthSession (no persistence). */
export async function acquireAuthCodeSession(deps: AcquireAuthCodeDeps): Promise<AuthSession> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const port = deps.redirectPort ?? DEFAULT_PORT;
  const pkce = (deps._generatePkce ?? generatePkce)();
  const state = (deps._generateState ?? generateState)();
  const baseUrl = deps.baseUrl.replace(/\/$/, "");
  const redirectUri = `http://localhost:${port}/callback`;
  const authUrl = new URL(`${baseUrl}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", deps.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("code_challenge", pkce.challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  if (deps.scope) authUrl.searchParams.set("scope", deps.scope);

  const code = await waitForCallbackCode({ port, state, timeoutMs, authUrl, deps });

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: pkce.verifier,
    client_id: deps.clientId,
    redirect_uri: redirectUri,
  });
  const res = await deps.http.send({
    method: "POST",
    url: deps.tokenUrl,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const body = JSON.parse(res.body) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== "string") throw new AuthError("Token endpoint returned no access_token");
  const ttlSec = typeof body.expires_in === "number" ? body.expires_in : 3600;
  return {
    access_token: body.access_token,
    ...(typeof body.refresh_token === "string" ? { refresh_token: body.refresh_token } : {}),
    expires_at: deps.now() + ttlSec * 1000 - 5000,
  };
}
```

Refactor the existing local-server promise in `runLogin` into a shared `waitForCallbackCode` helper so both `runLogin` and `acquireAuthCodeSession` use it. Extract the `new Promise<string>(...)` block (lines 61–123 of the current file) verbatim into:

```ts
// in plugins/oauth2/src/login.ts
interface CallbackDeps {
  port: number;
  state: string;
  timeoutMs: number;
  authUrl: URL;
  deps: { openBrowser: (url: string) => Promise<void>; stdout: (s: string) => void };
}

function waitForCallbackCode(c: CallbackDeps): Promise<string> {
  const { port, state, timeoutMs, authUrl } = c;
  const stdout = c.deps.stdout;
  return new Promise<string>((resolve, reject) => {
    // ...exact body from the current runLogin local-server Promise, with:
    //   - `stdout(...)` instead of the local stdout closure
    //   - `c.deps.openBrowser` instead of deps.openBrowser
    //   - `authUrl` from the argument
    //   - the timeout AuthError message updated to "Run 'dropsh auth login' to try again."
    //   - state-mismatch / EADDRINUSE / no-code handling kept verbatim
  });
}
```

Then change `runLogin` to call `waitForCallbackCode` (it keeps its own config-load + `writeToken`). This keeps `runLogin` green until Task 10.

- [ ] **Step 3: Write the failing provider test**

```ts
// plugins/oauth2/tests/unit/provider.test.ts
import { describe, expect, it, vi } from "vitest";
import type { AuthContext, HttpClient } from "dropsh/plugin";
import { oauth2Plugin } from "../../src/index.js";

function ctx(over: Partial<AuthContext> = {}): AuthContext {
  return {
    baseUrl: "https://example.com",
    http: { async send() { throw new Error("unused"); } },
    async prompt() { return ""; },
    async openBrowser() {},
    stdout() {},
    now() { return 1_000_000; },
    ...over,
  };
}

const tokenHttp = (body: object): HttpClient => ({
  async send() { return { status: 200, headers: {}, body: JSON.stringify(body) }; },
});

describe("oauth2 provider — client_credentials", () => {
  it("login prompts client_secret and returns a token session", async () => {
    const provider = oauth2Plugin({
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
    }).authProvider!;
    const prompt = vi.fn(async () => "the-secret");
    const session = await provider.login(ctx({ prompt, http: tokenHttp({ access_token: "tok", expires_in: 3600 }) }));
    expect(prompt).toHaveBeenCalledWith({ label: "Client secret", secret: true });
    expect(session.access_token).toBe("tok");
    expect(session.expires_at).toBe(1_000_000 + 3600 * 1000 - 5000);
  });

  it("createAdapter sets a Bearer header from the session", async () => {
    const provider = oauth2Plugin({
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
    }).authProvider!;
    const adapter = provider.createAdapter(
      { access_token: "tok", expires_at: 2_000_000 },
      { http: tokenHttp({}), now: () => 1_000_000, async save() {} },
    );
    const req = await adapter.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.Authorization).toBe("Bearer tok");
  });
});

describe("oauth2 provider — status", () => {
  it("reports expired when expires_at is in the past", async () => {
    const provider = oauth2Plugin({
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
    }).authProvider!;
    const info = await provider.status({ access_token: "t", expires_at: 5 });
    expect(info.loggedIn).toBe(true);
    expect(info.state).toBe("expired");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run plugins/oauth2/tests/unit/provider.test.ts`
Expected: FAIL — `oauth2Plugin(...).authProvider` is undefined.

- [ ] **Step 5: Implement the provider**

Create `plugins/oauth2/src/provider.ts`:

```ts
import type { AdapterRuntime, AuthAdapter, AuthContext, AuthProvider, AuthSession, HttpClient } from "dropsh/plugin";
import { AuthError, HttpError } from "dropsh/plugin";
import { acquireAuthCodeSession } from "./login.js";
import type { OAuth2Config } from "./index.js";

const DISPLAY: Record<OAuth2Config["type"], string> = {
  oauth2_authcode: "OAuth 2.0 (browser login, PKCE)",
  oauth2_password: "OAuth 2.0 (resource owner password)",
  oauth2_client_credentials: "OAuth 2.0 (client credentials)",
};

function bearer(req: { headers?: Record<string, string> }, token: string): Record<string, string> {
  return { ...(req.headers ?? {}), Authorization: `Bearer ${token}` };
}

async function postToken(http: HttpClient, url: string, params: URLSearchParams, now: () => number): Promise<AuthSession> {
  try {
    const res = await http.send({
      method: "POST",
      url,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const body = JSON.parse(res.body) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string") throw new AuthError("Token endpoint returned no access_token");
    const ttlSec = typeof body.expires_in === "number" ? body.expires_in : 3600;
    return {
      access_token: body.access_token,
      ...(typeof body.refresh_token === "string" ? { refresh_token: body.refresh_token } : {}),
      expires_at: now() + ttlSec * 1000 - 5000,
    };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    if (err instanceof HttpError) throw new AuthError(`Token request failed: HTTP ${err.status}`, { body: err.body });
    throw new AuthError(`Token request failed: ${(err as Error).message}`);
  }
}

export function oauth2Provider(cfg: OAuth2Config): AuthProvider {
  return {
    id: cfg.type,
    displayName: DISPLAY[cfg.type],
    capabilities: { login: true, logout: true, status: true },

    async login(ctx: AuthContext): Promise<AuthSession> {
      if (cfg.type === "oauth2_authcode") {
        return acquireAuthCodeSession({
          baseUrl: ctx.baseUrl,
          clientId: cfg.client_id,
          tokenUrl: cfg.token_url,
          ...(cfg.scope !== undefined ? { scope: cfg.scope } : {}),
          ...(cfg.redirect_port !== undefined ? { redirectPort: cfg.redirect_port } : {}),
          http: ctx.http,
          openBrowser: ctx.openBrowser,
          stdout: ctx.stdout,
          now: ctx.now,
        });
      }
      const params = new URLSearchParams({ client_id: cfg.client_id });
      const secret = await ctx.prompt({ label: "Client secret", secret: true });
      params.set("client_secret", secret);
      if (cfg.type === "oauth2_password") {
        const password = await ctx.prompt({ label: "Password", secret: true });
        params.set("grant_type", "password");
        params.set("username", cfg.username);
        params.set("password", password);
      } else {
        params.set("grant_type", "client_credentials");
      }
      if (cfg.scope) params.set("scope", cfg.scope);
      return postToken(ctx.http, cfg.token_url, params, ctx.now);
    },

    async logout() {
      // simple_oauth has no standard revoke endpoint wired; core clears the session.
    },

    async status(session) {
      if (!session) return { loggedIn: false, provider: cfg.type };
      const expiresAt = typeof session.expires_at === "number" ? session.expires_at : undefined;
      const info: { loggedIn: boolean; provider: string; expiresAt?: number; state?: "valid" | "expired" } = {
        loggedIn: true,
        provider: cfg.type,
      };
      if (expiresAt !== undefined) {
        info.expiresAt = expiresAt;
        info.state = expiresAt > Date.now() ? "valid" : "expired";
      }
      return info;
    },

    createAdapter(session: AuthSession, rt: AdapterRuntime): AuthAdapter {
      // Mutable reference to the live session, updated in place after a refresh
      // so subsequent requests reuse the new token instead of re-refreshing.
      let current = session;
      let refreshing: Promise<void> | null = null;

      async function doRefresh(refreshToken: string): Promise<void> {
        const params = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: cfg.client_id,
        });
        const refreshed = await postToken(rt.http, cfg.token_url, params, rt.now);
        if (typeof refreshed.refresh_token !== "string") refreshed.refresh_token = refreshToken;
        current = refreshed;
        await rt.save(refreshed);
      }

      return {
        async apply(req) {
          const token = current.access_token;
          const expiresAt = typeof current.expires_at === "number" ? current.expires_at : 0;
          if (typeof token === "string" && expiresAt - 30_000 > rt.now())
            return { ...req, headers: bearer(req, token) };
          const refresh = current.refresh_token;
          if (typeof refresh !== "string")
            throw new AuthError("Session expired. Run 'dropsh auth login'.");
          // Coalesce concurrent refreshes so we exchange the token only once.
          if (!refreshing) refreshing = doRefresh(refresh).finally(() => { refreshing = null; });
          await refreshing;
          return { ...req, headers: bearer(req, current.access_token as string) };
        },
      };
    },
  };
}
```

Then update `plugins/oauth2/src/index.ts`. Drop the secret fields (`client_secret`, `password`) from `OAuth2Config` — they are now prompted at login, never stored in config. Keep the non-secret connection params, including `username` for the password grant (per spec: username stays in config). New `OAuth2Config` + `validate()`:

```ts
export type OAuth2Config =
  | {
      type: "oauth2_password";
      client_id: string;
      username: string;
      token_url: string;
      scope?: string;
    }
  | {
      type: "oauth2_client_credentials";
      client_id: string;
      token_url: string;
      scope?: string;
    }
  | {
      type: "oauth2_authcode";
      client_id: string;
      token_url: string;
      scope?: string;
      redirect_port?: number;
    };

function validate(config: OAuth2Config): OAuth2Config {
  if (!config.client_id) throw new ConfigError("oauth2Plugin: client_id required");
  if (!config.token_url) throw new ConfigError("oauth2Plugin: token_url required");
  if (config.type === "oauth2_password" && !config.username)
    throw new ConfigError("oauth2Plugin: username required for oauth2_password");
  return config;
}
```

`provider.ts` reads `cfg.username` for the password grant (still typed) and prompts `client_secret` + `password`. Update `plugins/oauth2/tests/unit/oauth2.test.ts`-style fixtures and any config-example that passed `client_secret`/`password` (config example handled in Task 11).

Then replace the returned object's `createAuthAdapter`/`registerCommands` with `authProvider`:

```ts
import { oauth2Provider } from "./provider.js";
// ...
export function oauth2Plugin(config: OAuth2Config): DropSHPlugin {
  const cfg = validate(config);
  return {
    id: "oauth2",
    requiredModules: ["simple_oauth"],
    authProvider: oauth2Provider(cfg),
    async extendSchema(_entityType, _bundle, schema, _ctx) {
      return schema;
    },
  };
}
```

Remove the `createOAuth2Auth` / `createOAuth2AuthCodeAuth` imports from `index.ts` (now used only inside `provider.ts` if needed — they are not; `provider.ts` does its own token POST). Leave `oauth2.ts` / `oauth2-authcode.ts` files in place for now; they are deleted in Task 10.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run plugins/oauth2/tests/unit/provider.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 7: Keep the suite green**

Run: `pnpm run typecheck && pnpm -r test`
Expected: PASS. If the legacy `plugins/oauth2/tests/unit/oauth2.test.ts` / `oauth2-authcode.test.ts` / `login.test.ts` / `index.test.ts` reference removed behaviour (e.g. `registerCommands`), leave them for Task 10; if they fail to **compile** now, move them to Task 10 by temporarily skipping: add `.skip` to the failing `describe` and a `// TODO(task-10): migrate to provider model` comment. Note the skip in the commit message.

- [ ] **Step 8: Commit**

```bash
git add plugins/oauth2/src/provider.ts plugins/oauth2/src/index.ts plugins/oauth2/src/login.ts plugins/oauth2/tests/unit/provider.test.ts src/plugin-api.ts
git commit -m "feat(oauth2): expose AuthProvider with login/status/refresh"
```

---

### Task 8: `auth` command group (login / logout / status)

Adds the core `auth` command group that builds the registry, runs the picker, and reads/writes the session store. Wired into `buildProgram`.

**Files:**
- Create: `src/commands/auth.ts`
- Modify: `src/index.ts` (register the `auth` group; build the `AuthContext`)
- Test: `tests/unit/commands/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/commands/auth.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runAuthLogin, runAuthLogout, runAuthStatus } from "../../../src/commands/auth.js";
import { readSession } from "../../../src/core/auth/session-store.js";
import type { AuthProvider } from "../../../src/core/auth/types.js";

function provider(id: string, login = true): AuthProvider {
  return {
    id,
    displayName: id,
    capabilities: { login, logout: true, status: true },
    async login() { return { access_token: "tok", expires_at: 10 }; },
    async logout() {},
    async status(s) { return { loggedIn: s !== null, provider: id }; },
    createAdapter() { return { async apply(r) { return r; } }; },
  };
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "dropsh-test-"));
}

function deps(over: Record<string, unknown> = {}) {
  return {
    baseUrl: "https://example.com",
    providers: [provider("a"), provider("b")],
    stdout: vi.fn(),
    stderr: vi.fn(),
    prompt: vi.fn(async () => "1"),
    openBrowser: vi.fn(async () => {}),
    http: { async send() { throw new Error("unused"); } },
    now: () => 0,
    isTTY: true,
    ...over,
  };
}

describe("auth login", () => {
  it("with --provider writes the chosen provider's session", async () => {
    const stateDir = await tmp();
    await runAuthLogin({ provider: "b" }, { ...deps({ stateDir }) });
    const rec = await readSession("https://example.com", stateDir);
    expect(rec?.activeProvider).toBe("b");
    expect(rec?.session.access_token).toBe("tok");
  });

  it("with an unknown --provider errors and writes nothing", async () => {
    const stateDir = await tmp();
    const stderr = vi.fn();
    await expect(runAuthLogin({ provider: "zzz" }, { ...deps({ stateDir, stderr }) })).rejects.toThrow(/zzz/);
    expect(await readSession("https://example.com", stateDir)).toBeNull();
  });

  it("non-TTY without --provider errors", async () => {
    const stateDir = await tmp();
    await expect(runAuthLogin({}, { ...deps({ stateDir, isTTY: false }) })).rejects.toThrow(/non-interactive/);
  });

  it("interactive picker selects by number", async () => {
    const stateDir = await tmp();
    await runAuthLogin({}, { ...deps({ stateDir, prompt: vi.fn(async () => "2") }) });
    const rec = await readSession("https://example.com", stateDir);
    expect(rec?.activeProvider).toBe("b");
  });
});

describe("auth logout / status", () => {
  it("logout clears the session", async () => {
    const stateDir = await tmp();
    await runAuthLogin({ provider: "a" }, { ...deps({ stateDir }) });
    await runAuthLogout({}, { ...deps({ stateDir }) });
    expect(await readSession("https://example.com", stateDir)).toBeNull();
  });

  it("status with no session reports not logged in", async () => {
    const stateDir = await tmp();
    const stdout = vi.fn();
    await runAuthStatus({}, { ...deps({ stateDir, stdout }) });
    expect(stdout.mock.calls.flat().join("")).toContain("not logged in");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/commands/auth.test.ts`
Expected: FAIL — module `auth.js` not found.

- [ ] **Step 3: Implement the auth command functions**

```ts
// src/commands/auth.ts
import { AuthError, ConfigError } from "../errors.js";
import { clearSession, readSession, writeSession } from "../core/auth/session-store.js";
import { loginCapableProviders, providerById } from "../core/auth/registry.js";
import type { AuthContext, AuthProvider } from "../core/auth/types.js";

export interface AuthDeps {
  baseUrl: string;
  providers: AuthProvider[];
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  prompt: (opts: { label: string; secret?: boolean }) => Promise<string>;
  openBrowser: (url: string) => Promise<void>;
  http: AuthContext["http"];
  now: () => number;
  isTTY: boolean;
  stateDir?: string;
}

function authContext(deps: AuthDeps): AuthContext {
  const ctx: AuthContext = {
    baseUrl: deps.baseUrl,
    http: deps.http,
    prompt: deps.prompt,
    openBrowser: deps.openBrowser,
    stdout: deps.stdout,
    now: deps.now,
  };
  if (deps.stateDir !== undefined) ctx.stateDir = deps.stateDir;
  return ctx;
}

async function pickProvider(deps: AuthDeps, requestedId?: string): Promise<AuthProvider> {
  const capable = loginCapableProviders(deps.providers);
  if (capable.length === 0) throw new ConfigError("no login-capable auth provider configured");
  if (requestedId) {
    const found = providerById(capable, requestedId);
    if (!found)
      throw new ConfigError(
        `unknown provider '${requestedId}'. Available: ${capable.map((p) => p.id).join(", ")}`,
      );
    return found;
  }
  if (capable.length === 1) return capable[0] as AuthProvider;
  if (!deps.isTTY) throw new ConfigError("non-interactive: pass --provider <id>");
  deps.stdout("Select an auth provider:\n");
  capable.forEach((p, i) => deps.stdout(`  ${i + 1}) ${p.displayName} [${p.id}]\n`));
  const answer = await deps.prompt({ label: "Number" });
  const idx = Number.parseInt(answer, 10) - 1;
  const chosen = capable[idx];
  if (!chosen) throw new ConfigError(`invalid selection '${answer}'`);
  return chosen;
}

export async function runAuthLogin(args: { provider?: string }, deps: AuthDeps): Promise<void> {
  const provider = await pickProvider(deps, args.provider);
  const session = await provider.login(authContext(deps));
  await writeSession(deps.baseUrl, provider.id, session, deps.stateDir);
  deps.stdout(`logged in via ${provider.displayName}\n`);
}

export async function runAuthLogout(_args: Record<string, never>, deps: AuthDeps): Promise<void> {
  const rec = await readSession(deps.baseUrl, deps.stateDir);
  if (!rec) {
    deps.stdout("not logged in\n");
    return;
  }
  const provider = providerById(deps.providers, rec.activeProvider);
  try {
    if (provider) await provider.logout(authContext(deps));
  } catch (err) {
    // Best-effort revoke: never block local logout on a failing revoke call.
    deps.stderr(`warning: provider logout failed: ${String(err)}\n`);
  } finally {
    await clearSession(deps.baseUrl, deps.stateDir);
  }
  deps.stdout("logged out\n");
}

export async function runAuthStatus(args: { json?: boolean }, deps: AuthDeps): Promise<void> {
  const rec = await readSession(deps.baseUrl, deps.stateDir);
  if (!rec) {
    if (args.json) deps.stdout(`${JSON.stringify({ loggedIn: false })}\n`);
    else deps.stdout("not logged in\n");
    return;
  }
  const provider = providerById(deps.providers, rec.activeProvider);
  if (!provider) throw new AuthError(`active provider '${rec.activeProvider}' is not configured`);
  const info = await provider.status(rec.session);
  const host = new URL(deps.baseUrl).hostname;
  if (args.json) {
    deps.stdout(`${JSON.stringify({ ...info, host })}\n`);
    return;
  }
  deps.stdout(`provider: ${provider.displayName} [${provider.id}]\n`);
  deps.stdout(`host: ${host}\n`);
  if (info.expiresAt !== undefined)
    deps.stdout(`token: ${info.state} (until ${new Date(info.expiresAt).toISOString()})\n`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/commands/auth.test.ts`
Expected: PASS (6 cases).

- [ ] **Step 5: Wire the `auth` group into buildProgram**

In `src/index.ts`, add imports near the other command imports:

```ts
import { runAuthLogin, runAuthLogout, runAuthStatus } from "./commands/auth.js";
import { collectProviders } from "./core/auth/registry.js";
import { createPrompt } from "./core/cli/prompt.js";
```

Add a helper inside `buildProgram` that builds `AuthDeps` from the loaded config (it must load config independently of `contextFactory`, since auth runs before a session exists):

```ts
  async function authDeps(): Promise<import("./commands/auth.js").AuthDeps> {
    const cfg = await loadConfig(resolveConfigPath(program.opts().config as string | undefined));
    return {
      baseUrl: cfg.site.base_url,
      providers: collectProviders(cfg.plugins),
      stdout,
      stderr,
      prompt: createPrompt(),
      openBrowser: async (url: string) => {
        const { default: open } = await import("open");
        await open(url);
      },
      http: createHttpClient({ timeoutMs: cfg.defaults.timeout_ms }),
      now: Date.now,
      isTTY: Boolean(process.stdin.isTTY),
    };
  }
```

Register the group (place before the `if (opts.plugins)` block):

```ts
  const auth = program.command("auth").description("Manage authentication");
  auth
    .command("login")
    .description("Log in via an auth provider")
    .option("--provider <id>", "skip the picker and use this provider id")
    .action((o: { provider?: string }) =>
      run2(async () => runAuthLogin(o.provider ? { provider: o.provider } : {}, await authDeps())),
    );
  auth
    .command("logout")
    .description("Clear the active session")
    .action(() => run2(async () => runAuthLogout({}, await authDeps())));
  auth
    .command("status")
    .description("Show the active session")
    .option("--json", "machine-readable output")
    .action((o: { json?: boolean }) => run2(async () => runAuthStatus(o, await authDeps())));
```

Add a `run2` error wrapper next to the existing `run` (the existing `run` calls `contextFactory`, which auth must NOT do):

```ts
  async function run2(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      output.fail(err);
      setExitCode(exitCodeFor(err));
    }
  }
```

- [ ] **Step 6: Verify the wiring compiles and the help lists `auth`**

Run: `pnpm run typecheck`
Expected: PASS.
Run: `pnpm run build && node bin/dropsh auth --help`
Expected: lists `login`, `logout`, `status`.

- [ ] **Step 7: Commit**

```bash
git add src/commands/auth.ts src/index.ts tests/unit/commands/auth.test.ts
git commit -m "feat(auth): add 'dropsh auth login/logout/status' command group"
```

---

### Task 9: Switch runtime auth resolution to sessions

`defaultContext` no longer uses first-wins `createAuthAdapter`. It resolves the active session from the store and builds the adapter from that provider, with an `AdapterRuntime.save` that persists refreshes.

**Files:**
- Modify: `src/index.ts` (`defaultContext`)
- Test: `tests/unit/index.test.ts` (extend with a session-backed context test)

- [ ] **Step 1: Write the failing test**

Add a case asserting that, given a plugin with an `authProvider` and a written session, `defaultContext`-style resolution applies the provider's adapter. Since `defaultContext` is not exported, test the seam via a new small exported helper `resolveAuth`:

```ts
// tests/unit/index.test.ts — add
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAuth } from "../../src/index.js";
import { writeSession } from "../../src/core/auth/session-store.js";
import { basicAuthPlugin } from "../../src/core/auth/basic.js";

it("resolveAuth builds an adapter from the stored session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));
  const b64 = Buffer.from("u:p").toString("base64");
  await writeSession("https://example.com", "basic", { basic_b64: b64 }, dir);
  const adapter = await resolveAuth({
    baseUrl: "https://example.com",
    plugins: [basicAuthPlugin()],
    http: { async send() { throw new Error("unused"); } },
    now: () => 0,
    stateDir: dir,
  });
  const req = await adapter.apply({ method: "GET", url: "https://x" });
  expect(req.headers?.Authorization).toBe(`Basic ${b64}`);
});

it("resolveAuth throws AuthError when there is no session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));
  await expect(
    resolveAuth({
      baseUrl: "https://example.com",
      plugins: [basicAuthPlugin()],
      http: { async send() { throw new Error("unused"); } },
      now: () => 0,
      stateDir: dir,
    }),
  ).rejects.toThrow(/auth login/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/index.test.ts`
Expected: FAIL — `resolveAuth` not exported.

- [ ] **Step 3: Implement `resolveAuth` and use it in `defaultContext`**

Add to `src/index.ts`:

Add `AuthError` to the existing `./errors.js` import in `src/index.ts` (it currently imports only `ConfigError, exitCodeFor`):

```ts
import { AuthError, ConfigError, exitCodeFor } from "./errors.js";
```

```ts
import { collectProviders, providerById } from "./core/auth/registry.js";
import { readSession, writeSession } from "./core/auth/session-store.js";
import type { AuthAdapter } from "./core/auth/types.js";

export interface ResolveAuthDeps {
  baseUrl: string;
  plugins: DropSHPlugin[];
  http: HttpClient;
  now: () => number;
  stateDir?: string;
}

export async function resolveAuth(deps: ResolveAuthDeps): Promise<AuthAdapter> {
  const rec = await readSession(deps.baseUrl, deps.stateDir);
  if (!rec) throw new AuthError("Not authenticated. Run 'dropsh auth login'.");
  const provider = providerById(collectProviders(deps.plugins), rec.activeProvider);
  if (!provider)
    throw new ConfigError(`active provider '${rec.activeProvider}' is not configured`);
  return provider.createAdapter(rec.session, {
    http: deps.http,
    now: deps.now,
    save: (session) => writeSession(deps.baseUrl, provider.id, session, deps.stateDir),
  });
}
```

Replace the `authPlugin`/`createAuthAdapter` block in `defaultContext` with:

```ts
  const auth = await resolveAuth({
    baseUrl: cfg.site.base_url,
    plugins: cfg.plugins,
    http,
    now: Date.now,
  });
```

(Missing session throws `AuthError` → exit code 3, matching the spec's "runtime with no session → AuthError run dropsh auth login". A misconfigured/unknown active provider is a config problem → `ConfigError` (exit 2). The provider's own runtime `apply` also throws `AuthError` for an expired token.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/index.test.ts`
Expected: PASS (including the two new cases).

- [ ] **Step 5: Fix the existing index/smoke tests**

The existing `tests/unit/index.test.ts` and `tests/unit/smoke.test.ts` build a program with a stubbed `contextFactory`, so they do not hit `resolveAuth`. Run the whole suite:

Run: `pnpm test`
Expected: PASS. Fix any test that constructed a plugin via `basicAuthPlugin({ username, password })` (old signature) — change to `basicAuthPlugin()` or `basicAuthPlugin({ username })`.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/unit/index.test.ts
git commit -m "feat(auth): resolve runtime auth from the active session"
```

---

### Task 10: Remove legacy auth path

Delete the dead first-wins adapter API and the oauth2 plugin's own token store / command registration, and migrate remaining tests.

**Files:**
- Modify: `src/core/plugin.ts` (remove `createAuthAdapter?`)
- Modify: `src/plugin-api.ts` (drop removed exports, keep new ones)
- Delete: `plugins/oauth2/src/token-store.ts`, `plugins/oauth2/src/oauth2.ts`, `plugins/oauth2/src/oauth2-authcode.ts`
- Modify: `plugins/oauth2/src/login.ts` (remove `runLogin` + `writeToken` import; keep PKCE helpers + `acquireAuthCodeSession` + `waitForCallbackCode`)
- Delete/migrate tests: `plugins/oauth2/tests/unit/token-store.test.ts`, `oauth2.test.ts`, `oauth2-authcode.test.ts`, `login.test.ts`, `index.test.ts`

- [ ] **Step 1: Remove `createAuthAdapter` from the plugin interface**

In `src/core/plugin.ts` delete the line `createAuthAdapter?(): AuthAdapter;` and the now-unused `AuthAdapter` import if nothing else uses it (keep `AuthProvider`).

- [ ] **Step 2: Update plugin-api exports**

`src/plugin-api.ts` should export: `basicAuthPlugin`, `basicAuthProvider`, `BasicAuthConfig`, `AuthAdapter`, `AdapterRuntime`, `AuthContext`, `AuthProvider`, `AuthSession`, `AuthStatusInfo`, `Config`, `SiteConfig`, `loadConfig`, `HttpClient`, `HttpRequest`, `createHttpClient`, `DropSHPlugin`, `PluginContext`, `SchemaOperation`, `AuthError`, `ConfigError`, `HttpError`. Remove nothing the plugins still import; verify with typecheck.

- [ ] **Step 3: Delete the dead oauth2 modules**

```bash
git rm plugins/oauth2/src/token-store.ts plugins/oauth2/src/oauth2.ts plugins/oauth2/src/oauth2-authcode.ts
git rm plugins/oauth2/tests/unit/token-store.test.ts plugins/oauth2/tests/unit/oauth2.test.ts plugins/oauth2/tests/unit/oauth2-authcode.test.ts
```

In `plugins/oauth2/src/login.ts` remove `runLogin` and the `import { writeToken } from "./token-store.js"` and the `loadConfig` usage; keep `generatePkce`, `generateState`, `waitForCallbackCode`, `acquireAuthCodeSession`.

- [ ] **Step 4: Migrate the remaining oauth2 tests**

Rewrite `plugins/oauth2/tests/unit/login.test.ts` to test `acquireAuthCodeSession` returning a session (inject `_generatePkce`, `_generateState`, a fake `http`, and an `openBrowser`/callback driver). Rewrite `plugins/oauth2/tests/unit/index.test.ts` to assert `oauth2Plugin(cfg).authProvider.id === cfg.type` and `requiredModules` includes `simple_oauth`. Remove any `.skip` added in Task 7 Step 7.

Concrete `index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { oauth2Plugin } from "../../src/index.js";

describe("oauth2Plugin", () => {
  it("exposes an authProvider whose id matches the configured grant type", () => {
    const plugin = oauth2Plugin({ type: "oauth2_client_credentials", client_id: "c", client_secret: "s", token_url: "https://x/oauth/token" });
    expect(plugin.authProvider?.id).toBe("oauth2_client_credentials");
    expect(plugin.requiredModules).toContain("simple_oauth");
  });

  it("validates required fields", () => {
    expect(() => oauth2Plugin({ type: "oauth2_authcode", client_id: "", token_url: "https://x/oauth/token" })).toThrow();
  });
});
```

- [ ] **Step 5: Run the full gate**

Run: `pnpm run lint && pnpm run typecheck && pnpm -r test`
Expected: PASS. Fix fallout (unused imports, old signatures) until green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(auth): remove legacy createAuthAdapter + oauth2 token-store"
```

---

### Task 11: Docs + integration tests

**Files:**
- Modify: `README.md` (auth section)
- Modify: `dropsh.config.example.js` (drop secrets, keep connection params)
- Modify: `tests/integrations/auth-oauth2-password.test.ts`, `tests/integrations/auth-oauth2-client-credentials.test.ts`, `tests/integrations/auth-basic.test.ts`
- Modify: `tests/integrations/helpers/config.ts` / `run.ts` if they pre-seed auth

- [ ] **Step 1: Update README auth section**

Document the new flow: `dropsh auth login` (picker / `--provider`), `dropsh auth logout`, `dropsh auth status [--json]`; that secrets are prompted and stored under `~/.config/dropsh/<host>.json` (mode 0600); that config carries only non-secret connection params. Show a config example:

```js
import { basicAuthPlugin } from "dropsh";
import { oauth2Plugin } from "@dropsh/plugin-oauth2";

export default {
  site: { base_url: "https://my-drupal.example.com", jsonapi_prefix: "/jsonapi" },
  plugins: [
    basicAuthPlugin(),
    oauth2Plugin({ type: "oauth2_authcode", client_id: "my-client", token_url: "https://my-drupal.example.com/oauth/token" }),
  ],
};
```

- [ ] **Step 2: Update the config example file**

Edit `dropsh.config.example.js` to remove `username`/`password`/`client_secret` and keep only connection params, matching the README example.

- [ ] **Step 3: Adapt integration tests to seed a session**

These tests run against DDEV. For password / client_credentials, the test must drive `provider.login(ctx)` with a fake `prompt` returning the secret, then `writeSession`, then run a command. Update each to:
1. Build the provider from `oauth2Plugin(cfg).authProvider`.
2. Call `login` with a stub `ctx` (real `http`, `prompt` returning the env secret, fixed `now`).
3. `writeSession(baseUrl, provider.id, session, stateDir)`.
4. Run a `read`/`schema` command with `DROPSH` pointed at a config whose plugin list includes that provider, and the session store `stateDir` honoured (pass through an env/CLI seam, or set `XDG`/`HOME` to the tmp dir for the integration run).

For `auth-basic.test.ts`, seed `{ basic_b64 }` via `basicAuthProvider().login(ctx)` with stub prompts, then `writeSession`.

The authcode/browser flow stays manual — add a comment documenting how to run it by hand.

- [ ] **Step 4: Run integration tests (local DDEV)**

```bash
pnpm run drupal:up
pnpm run test:integration
pnpm run drupal:down
```

Expected: PASS for basic + oauth2 password + client_credentials. (Not run in CI.)

- [ ] **Step 5: Commit**

```bash
git add README.md dropsh.config.example.js tests/integrations
git commit -m "docs+test(auth): document provider login and adapt integration tests"
```

---

## Self-Review

**Spec coverage:**
- Registry from `config.plugins` → Task 5 + Task 9 (`collectProviders`). ✓
- Single active session, login replaces → Task 2 (`writeSession` overwrites) + Task 8. ✓
- `auth login` picker over login-capable providers, `--provider`, non-TTY error, single-provider shortcut → Task 8. ✓
- `auth logout` / `auth status` (+`--json`) on the active session → Task 8. ✓
- Interactive credentials, stored in state dir, no secrets in config → Tasks 3, 6, 7 (prompts) + Task 11 (config example). ✓
- Non-secret params stay in config → oauth2 `OAuth2Config` keeps `client_id`/`token_url`/`scope`/`redirect_port`/`username` but drops `client_secret`/`password` which are prompted (Task 7); basic optional `username` (Task 6). ✓
- `AuthProvider` interface + `AuthAdapter` runtime piece via `createAdapter` → Task 1 (interface), Task 4 (plugin field). ✓
- State store `~/.config/dropsh/<host>.json`, mode 0600, `{activeProvider, session}` → Task 2. ✓
- Providers: oauth2-authcode/password/client_credentials + basic → Tasks 6, 7. ✓
- Errors: ConfigError no-session/no-provider, AuthError expired → Tasks 8, 9. ✓
- Testing: AuthContext mockable, store roundtrip, picker dispatch, integration, migration → Tasks 2–11. ✓
- Out of scope (auto-discovery, multi-session) → not implemented. ✓

**Placeholder scan:** No TBD/TODO except the explicit, code-bearing migration notes in Task 7 Step 7 / Task 10. No "add error handling" hand-waves. ✓

**Type consistency:** `AuthProvider.createAdapter(session, rt)` with `AdapterRuntime { http, now, save }` is used identically in Tasks 1, 6, 7, 9. `writeSession(baseUrl, activeProvider, session, dir?)` arg order matches across Tasks 2, 8, 9, 11. `AuthDeps` fields match between Task 8 test and impl. `AuthContext` fields (`baseUrl/http/stateDir?/prompt/openBrowser/stdout/now`) consistent in Tasks 1, 6, 7, 8. ✓
