# login OAuth2 Authorization Code + PKCE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `drupal-cli login` that authenticates via OAuth 2.0 Authorization Code + PKCE, stores tokens in `~/.config/drupal-cli/<hostname>.json`, and enables silent refresh in all other commands.

**Architecture:** Three new modules — `token-store.ts` (file I/O), `oauth2-authcode.ts` (AuthAdapter with silent refresh), `login.ts` (interactive browser flow) — wired into the existing factory and CLI entry point. All external dependencies are injectable so every unit is testable without a real browser or Drupal server.

**Tech Stack:** Node.js `crypto` (PKCE), Node.js `http` (callback server), `open` npm package (browser launch), TypeScript 5, vitest.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add `open` runtime dependency |
| `src/core/config.ts` | Modify | Add `"oauth2_authcode"` to `AuthConfig.type` union |
| `src/core/auth/token-store.ts` | Create | Read/write `~/.config/drupal-cli/<hostname>.json` |
| `src/core/auth/oauth2-authcode.ts` | Create | `AuthAdapter` for `oauth2_authcode`: reads token, silent refresh |
| `src/core/auth/factory.ts` | Modify | Add `case "oauth2_authcode"` |
| `src/commands/login.ts` | Create | PKCE generation, localhost callback server, browser open, token exchange |
| `src/index.ts` | Modify | Register `login` command |
| `tests/unit/core/auth/token-store.test.ts` | Create | Unit tests for token-store |
| `tests/unit/core/auth/oauth2-authcode.test.ts` | Create | Unit tests for oauth2-authcode adapter |
| `tests/unit/commands/login.test.ts` | Create | Unit tests for login command |
| `tests/unit/fixtures/config/oauth2-authcode.yml` | Create | Fixture config for login tests |
| `tests/unit/fixtures/config/basic-noenv.yml` | Create | Fixture with basic auth (no env vars) for wrong-type test |

---

## Task 1: Install `open` and extend `AuthConfig.type`

**Files:**
- Modify: `package.json`
- Modify: `src/core/config.ts:7`

- [ ] **Step 1: Install the `open` package**

```bash
npm install open
```

Expected: `open` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Add `"oauth2_authcode"` to the type union in `src/core/config.ts`**

Current line 7:
```typescript
  type: "basic" | "oauth2_password" | "oauth2_client_credentials";
```

New line 7:
```typescript
  type: "basic" | "oauth2_password" | "oauth2_client_credentials" | "oauth2_authcode";
```

- [ ] **Step 3: Verify no type errors**

```bash
npm run typecheck
```

Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/core/config.ts
git commit -m "feat: add oauth2_authcode to AuthConfig.type union, install open"
```

---

## Task 2: `token-store.ts` — TDD

**Files:**
- Create: `src/core/auth/token-store.ts`
- Create: `tests/unit/core/auth/token-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/core/auth/token-store.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { mkdtemp, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readToken, writeToken, type StoredToken } from "../../../../src/core/auth/token-store.js";

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "drupal-cli-test-"));
  await fn(dir);
}

describe("token-store", () => {
  it("returns null when token file does not exist", async () => {
    await withTmpDir(async (dir) => {
      const result = await readToken("https://example.com", dir);
      expect(result).toBeNull();
    });
  });

  it("reads a written token back correctly", async () => {
    await withTmpDir(async (dir) => {
      const token: StoredToken = {
        access_token: "tok1",
        refresh_token: "ref1",
        expires_at: 9999,
      };
      await writeToken("https://example.com", token, dir);
      const result = await readToken("https://example.com", dir);
      expect(result).toEqual(token);
    });
  });

  it("writes token file with 0600 permissions", async () => {
    await withTmpDir(async (dir) => {
      const token: StoredToken = { access_token: "tok", expires_at: 1234 };
      await writeToken("https://example.com", token, dir);
      const info = await stat(join(dir, "example.com.json"));
      expect(info.mode & 0o777).toBe(0o600);
    });
  });

  it("creates the token directory if it does not exist", async () => {
    await withTmpDir(async (dir) => {
      const nested = join(dir, "sub", "drupal-cli");
      const token: StoredToken = { access_token: "tok", expires_at: 1234 };
      await writeToken("https://example.com", token, nested);
      const result = await readToken("https://example.com", nested);
      expect(result?.access_token).toBe("tok");
    });
  });

  it("uses hostname as filename, ignoring path and port", async () => {
    await withTmpDir(async (dir) => {
      const token: StoredToken = { access_token: "x", expires_at: 0 };
      await writeToken("https://my.site.example.org:8080/some/path", token, dir);
      const raw = await readFile(join(dir, "my.site.example.org.json"), "utf8");
      expect(JSON.parse(raw).access_token).toBe("x");
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- --reporter=verbose tests/unit/core/auth/token-store.test.ts
```

Expected: all 5 tests fail with "Cannot find module" or similar.

- [ ] **Step 3: Write the implementation**

Create `src/core/auth/token-store.ts`:

```typescript
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StoredToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

function hostnameFromUrl(baseUrl: string): string {
  return new URL(baseUrl).hostname;
}

export function defaultTokenDir(): string {
  return join(homedir(), ".config", "drupal-cli");
}

export async function readToken(baseUrl: string, dir?: string): Promise<StoredToken | null> {
  const d = dir ?? defaultTokenDir();
  const path = join(d, `${hostnameFromUrl(baseUrl)}.json`);
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as StoredToken;
  } catch {
    return null;
  }
}

export async function writeToken(baseUrl: string, token: StoredToken, dir?: string): Promise<void> {
  const d = dir ?? defaultTokenDir();
  await mkdir(d, { recursive: true });
  const path = join(d, `${hostnameFromUrl(baseUrl)}.json`);
  await writeFile(path, JSON.stringify(token, null, 2), { mode: 0o600, encoding: "utf8" });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- --reporter=verbose tests/unit/core/auth/token-store.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/auth/token-store.ts tests/unit/core/auth/token-store.test.ts
git commit -m "feat: token-store read/write with 0600 permissions"
```

---

## Task 3: `oauth2-authcode.ts` — TDD

**Files:**
- Create: `src/core/auth/oauth2-authcode.ts`
- Create: `tests/unit/core/auth/oauth2-authcode.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/core/auth/oauth2-authcode.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createOAuth2AuthCodeAuth } from "../../../../src/core/auth/oauth2-authcode.js";
import { readToken, writeToken } from "../../../../src/core/auth/token-store.js";
import { AuthError } from "../../../../src/errors.js";
import type { HttpClient } from "../../../../src/core/http.js";

function httpMock(responses: Array<{ status: number; body: unknown }>): HttpClient {
  let i = 0;
  return {
    async send() {
      const r = responses[i++];
      if (!r) throw new Error("unexpected http call");
      if (r.status >= 200 && r.status < 300) {
        return { status: r.status, headers: {}, body: JSON.stringify(r.body) };
      }
      const { HttpError } = await import("../../../../src/errors.js");
      throw new HttpError(r.status, `HTTP ${r.status}`, r.body);
    },
  };
}

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "drupal-cli-test-"));
  await fn(dir);
}

const BASE = "https://example.com";
const CFG = { type: "oauth2_authcode" as const, client_id: "my-client" };

describe("oauth2-authcode adapter", () => {
  it("attaches Bearer header when access token is still valid", async () => {
    await withTmpDir(async (dir) => {
      await writeToken(BASE, { access_token: "valid-tok", expires_at: 9_999_999_999_000 }, dir);
      const adapter = createOAuth2AuthCodeAuth(CFG, {
        http: httpMock([]),
        baseUrl: BASE,
        now: () => 0,
        tokenDir: dir,
      });
      const req = await adapter.apply({ method: "GET", url: "https://example.com/jsonapi" });
      expect(req.headers?.Authorization).toBe("Bearer valid-tok");
    });
  });

  it("makes no network call when token is valid", async () => {
    await withTmpDir(async (dir) => {
      await writeToken(BASE, { access_token: "tok", expires_at: 9_999_999_999_000 }, dir);
      let calls = 0;
      const http: HttpClient = {
        async send() {
          calls++;
          return { status: 200, headers: {}, body: "{}" };
        },
      };
      const adapter = createOAuth2AuthCodeAuth(CFG, { http, baseUrl: BASE, now: () => 0, tokenDir: dir });
      await adapter.apply({ method: "GET", url: "https://example.com" });
      expect(calls).toBe(0);
    });
  });

  it("silently refreshes when access token is expired", async () => {
    await withTmpDir(async (dir) => {
      const http = httpMock([
        {
          status: 200,
          body: { access_token: "new-tok", refresh_token: "new-ref", expires_in: 3600 },
        },
      ]);
      await writeToken(
        BASE,
        { access_token: "old-tok", refresh_token: "old-ref", expires_at: 1000 },
        dir,
      );
      const adapter = createOAuth2AuthCodeAuth(CFG, {
        http,
        baseUrl: BASE,
        now: () => 2_000_000,
        tokenDir: dir,
      });
      const req = await adapter.apply({ method: "GET", url: "https://example.com/jsonapi" });
      expect(req.headers?.Authorization).toBe("Bearer new-tok");
    });
  });

  it("writes the refreshed token back to disk", async () => {
    await withTmpDir(async (dir) => {
      const http = httpMock([
        {
          status: 200,
          body: { access_token: "new-tok", refresh_token: "new-ref", expires_in: 3600 },
        },
      ]);
      await writeToken(
        BASE,
        { access_token: "old-tok", refresh_token: "old-ref", expires_at: 1000 },
        dir,
      );
      const adapter = createOAuth2AuthCodeAuth(CFG, {
        http,
        baseUrl: BASE,
        now: () => 2_000_000,
        tokenDir: dir,
      });
      await adapter.apply({ method: "GET", url: "https://example.com" });
      const stored = await readToken(BASE, dir);
      expect(stored?.access_token).toBe("new-tok");
      expect(stored?.refresh_token).toBe("new-ref");
    });
  });

  it("uses old refresh_token when server does not return a new one", async () => {
    await withTmpDir(async (dir) => {
      const http = httpMock([
        { status: 200, body: { access_token: "new-tok", expires_in: 3600 } },
      ]);
      await writeToken(
        BASE,
        { access_token: "old-tok", refresh_token: "keep-ref", expires_at: 1000 },
        dir,
      );
      const adapter = createOAuth2AuthCodeAuth(CFG, {
        http,
        baseUrl: BASE,
        now: () => 2_000_000,
        tokenDir: dir,
      });
      await adapter.apply({ method: "GET", url: "https://example.com" });
      const stored = await readToken(BASE, dir);
      expect(stored?.refresh_token).toBe("keep-ref");
    });
  });

  it("throws AuthError when access token expired and no refresh_token stored", async () => {
    await withTmpDir(async (dir) => {
      await writeToken(BASE, { access_token: "old-tok", expires_at: 1000 }, dir);
      const adapter = createOAuth2AuthCodeAuth(CFG, {
        http: httpMock([]),
        baseUrl: BASE,
        now: () => 2_000_000,
        tokenDir: dir,
      });
      await expect(
        adapter.apply({ method: "GET", url: "https://example.com" }),
      ).rejects.toBeInstanceOf(AuthError);
    });
  });

  it("throws AuthError when refresh request returns HTTP error", async () => {
    await withTmpDir(async (dir) => {
      const http = httpMock([{ status: 401, body: { error: "invalid_token" } }]);
      await writeToken(
        BASE,
        { access_token: "old", refresh_token: "ref", expires_at: 1000 },
        dir,
      );
      const adapter = createOAuth2AuthCodeAuth(CFG, {
        http,
        baseUrl: BASE,
        now: () => 2_000_000,
        tokenDir: dir,
      });
      await expect(
        adapter.apply({ method: "GET", url: "https://example.com" }),
      ).rejects.toBeInstanceOf(AuthError);
    });
  });

  it("throws AuthError when no token file exists", async () => {
    await withTmpDir(async (dir) => {
      const adapter = createOAuth2AuthCodeAuth(CFG, {
        http: httpMock([]),
        baseUrl: BASE,
        tokenDir: dir,
      });
      await expect(
        adapter.apply({ method: "GET", url: "https://example.com" }),
      ).rejects.toBeInstanceOf(AuthError);
    });
  });

  it("throws AuthError at construction when client_id is missing", () => {
    expect(() =>
      createOAuth2AuthCodeAuth(
        { type: "oauth2_authcode" as const, client_id: "" },
        { http: httpMock([]), baseUrl: BASE },
      ),
    ).toThrow(AuthError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- --reporter=verbose tests/unit/core/auth/oauth2-authcode.test.ts
```

Expected: all tests fail with "Cannot find module".

- [ ] **Step 3: Write the implementation**

Create `src/core/auth/oauth2-authcode.ts`:

```typescript
import type { AuthConfig } from "../config.js";
import type { HttpClient, HttpRequest } from "../http.js";
import { AuthError, HttpError } from "../../errors.js";
import type { AuthAdapter } from "./types.js";
import { readToken, writeToken } from "./token-store.js";

export interface OAuth2AuthCodeDeps {
  http: HttpClient;
  baseUrl: string;
  now?: () => number;
  tokenDir?: string;
}

export function createOAuth2AuthCodeAuth(cfg: AuthConfig, deps: OAuth2AuthCodeDeps): AuthAdapter {
  const now = deps.now ?? Date.now;
  const clientId = cfg.client_id;
  if (typeof clientId !== "string" || clientId.length === 0) {
    throw new AuthError("oauth2_authcode auth requires client_id");
  }
  const tokenUrl =
    typeof cfg.token_url === "string"
      ? cfg.token_url
      : `${deps.baseUrl.replace(/\/$/, "")}/oauth/token`;

  return {
    async apply(req: HttpRequest): Promise<HttpRequest> {
      const stored = await readToken(deps.baseUrl, deps.tokenDir);

      if (!stored) {
        throw new AuthError("Session expired. Run 'drupal-cli login' to authenticate.");
      }

      if (stored.expires_at - 30_000 > now()) {
        return {
          ...req,
          headers: { ...(req.headers ?? {}), Authorization: `Bearer ${stored.access_token}` },
        };
      }

      if (!stored.refresh_token) {
        throw new AuthError("Session expired. Run 'drupal-cli login' to authenticate.");
      }

      try {
        const params = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: stored.refresh_token,
          client_id: clientId,
        });
        const res = await deps.http.send({
          method: "POST",
          url: tokenUrl,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
        const body = JSON.parse(res.body) as {
          access_token?: unknown;
          refresh_token?: unknown;
          expires_in?: unknown;
        };
        if (typeof body.access_token !== "string") {
          throw new AuthError("Token endpoint returned no access_token");
        }
        const ttlSec = typeof body.expires_in === "number" ? body.expires_in : 3600;
        const newToken = {
          access_token: body.access_token,
          refresh_token:
            typeof body.refresh_token === "string"
              ? body.refresh_token
              : stored.refresh_token,
          expires_at: now() + ttlSec * 1000 - 5000,
        };
        await writeToken(deps.baseUrl, newToken, deps.tokenDir);
        return {
          ...req,
          headers: { ...(req.headers ?? {}), Authorization: `Bearer ${newToken.access_token}` },
        };
      } catch (err) {
        if (err instanceof AuthError) throw err;
        throw new AuthError("Session expired. Run 'drupal-cli login' to authenticate.");
      }
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- --reporter=verbose tests/unit/core/auth/oauth2-authcode.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/auth/oauth2-authcode.ts tests/unit/core/auth/oauth2-authcode.test.ts
git commit -m "feat: oauth2-authcode AuthAdapter with silent token refresh"
```

---

## Task 4: Wire `factory.ts` — TDD

**Files:**
- Modify: `src/core/auth/factory.ts`
- Modify: `tests/unit/core/auth/factory.test.ts`

- [ ] **Step 1: Add a failing test for the new factory case**

Append to `tests/unit/core/auth/factory.test.ts` inside the existing `describe` block:

```typescript
  it("creates oauth2_authcode adapter", () => {
    const a = createAuthAdapter(
      { type: "oauth2_authcode", client_id: "cid" },
      { http, baseUrl: "https://x" },
    );
    expect(a.apply).toBeTypeOf("function");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- --reporter=verbose tests/unit/core/auth/factory.test.ts
```

Expected: the new test fails with "Unknown auth.type: oauth2_authcode".

- [ ] **Step 3: Add the case to `src/core/auth/factory.ts`**

Add the import at the top of the file (after the existing imports):

```typescript
import { createOAuth2AuthCodeAuth } from "./oauth2-authcode.js";
```

Add the new case in the `switch` statement (before `default`):

```typescript
    case "oauth2_authcode":
      return createOAuth2AuthCodeAuth(cfg, { http: deps.http, baseUrl: deps.baseUrl });
```

- [ ] **Step 4: Run all factory tests to verify they pass**

```bash
npm test -- --reporter=verbose tests/unit/core/auth/factory.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/auth/factory.ts tests/unit/core/auth/factory.test.ts
git commit -m "feat: wire oauth2_authcode in auth factory"
```

---

## Task 5: `login.ts` — pure-function tests first (PKCE + state)

**Files:**
- Create: `src/commands/login.ts` (pure functions only in this task)
- Create: `tests/unit/commands/login.test.ts` (PKCE + state tests only)
- Create: `tests/unit/fixtures/config/oauth2-authcode.yml`
- Create: `tests/unit/fixtures/config/basic-noenv.yml`

- [ ] **Step 1: Create the fixture config files**

Create `tests/unit/fixtures/config/oauth2-authcode.yml`:

```yaml
site:
  base_url: https://example.com
  auth:
    type: oauth2_authcode
    client_id: test-client
    scope: "openid offline_access"

defaults:
  dry_run: false
  timeout_ms: 30000
```

Create `tests/unit/fixtures/config/basic-noenv.yml`:

```yaml
site:
  base_url: https://example.com
  auth:
    type: basic
    username: testuser
    password: testpass

defaults:
  dry_run: false
  timeout_ms: 30000
```

- [ ] **Step 2: Write the failing PKCE + state tests**

Create `tests/unit/commands/login.test.ts` with only the pure-function describe blocks:

```typescript
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { generatePkce, generateState } from "../../../../src/commands/login.js";

describe("generatePkce", () => {
  it("produces a valid SHA-256 PKCE challenge", () => {
    const { verifier, challenge } = generatePkce();
    expect(verifier.length).toBeGreaterThan(0);
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
  });

  it("uses base64url encoding (no +, /, = characters)", () => {
    for (let i = 0; i < 20; i++) {
      const { verifier, challenge } = generatePkce();
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("produces unique verifiers each call", () => {
    const a = generatePkce();
    const b = generatePkce();
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe("generateState", () => {
  it("returns a non-empty base64url string", () => {
    const s = generateState();
    expect(typeof s).toBe("string");
    expect(s.length).toBeGreaterThan(0);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces unique values each call", () => {
    expect(generateState()).not.toBe(generateState());
  });
});
```

- [ ] **Step 3: Run to verify they fail**

```bash
npm test -- --reporter=verbose tests/unit/commands/login.test.ts
```

Expected: all tests fail with "Cannot find module".

- [ ] **Step 4: Write the pure-function portion of `src/commands/login.ts`**

Create `src/commands/login.ts` with only the pure functions (full implementation comes in Task 6):

```typescript
import { randomBytes, createHash } from "node:crypto";

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(96).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(16).toString("base64url");
}
```

- [ ] **Step 5: Run to verify pure-function tests pass**

```bash
npm test -- --reporter=verbose tests/unit/commands/login.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/commands/login.ts tests/unit/commands/login.test.ts \
        tests/unit/fixtures/config/oauth2-authcode.yml \
        tests/unit/fixtures/config/basic-noenv.yml
git commit -m "feat: PKCE and state generation for login command"
```

---

## Task 6: `runLogin` full flow — TDD

**Files:**
- Modify: `src/commands/login.ts` (add full `runLogin`)
- Modify: `tests/unit/commands/login.test.ts` (add `runLogin` describe block)

- [ ] **Step 1: Append `runLogin` tests to `tests/unit/commands/login.test.ts`**

Add the following imports at the top of the file (after the existing imports):

```typescript
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLogin } from "../../../../src/commands/login.js";
import type { HttpClient } from "../../../../src/core/http.js";
import { AuthError } from "../../../../src/errors.js";
```

Add these helpers after the existing imports section:

```typescript
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  path.join(here, "../../fixtures/config", name);

const PORT = 7432;

function httpMock(body: unknown): HttpClient {
  return {
    async send() {
      return { status: 200, headers: {}, body: JSON.stringify(body) };
    },
  };
}

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "drupal-cli-test-"));
  await fn(dir);
}

function makeOpenBrowser(state: string, code: string): (url: string) => Promise<void> {
  return async () => {
    await fetch(`http://localhost:${PORT}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
  };
}
```

Append the `runLogin` describe block to the file:

```typescript
describe("runLogin", () => {
  it("completes full flow, writes token, and prints success", async () => {
    await withTmpDir(async (dir) => {
      const knownState = "known-state";
      const knownCode = "auth-code-xyz";
      const logs: string[] = [];

      await runLogin({
        configPath: fixture("oauth2-authcode.yml"),
        http: httpMock({
          access_token: "tok123",
          refresh_token: "ref456",
          expires_in: 3600,
        }),
        openBrowser: makeOpenBrowser(knownState, knownCode),
        _generateState: () => knownState,
        tokenDir: dir,
        stdout: (s) => logs.push(s),
        now: () => 0,
      });

      const raw = await readFile(join(dir, "example.com.json"), "utf8");
      const stored = JSON.parse(raw);
      expect(stored.access_token).toBe("tok123");
      expect(stored.refresh_token).toBe("ref456");
      expect(logs.some((l) => l.includes("Logged in"))).toBe(true);
    });
  });

  it("throws AuthError when received state does not match", async () => {
    await withTmpDir(async (dir) => {
      await expect(
        runLogin({
          configPath: fixture("oauth2-authcode.yml"),
          http: httpMock({ access_token: "tok" }),
          openBrowser: makeOpenBrowser("wrong-state", "some-code"),
          _generateState: () => "correct-state",
          tokenDir: dir,
          stdout: () => {},
          timeoutMs: 5000,
        }),
      ).rejects.toBeInstanceOf(AuthError);
    });
  });

  it("throws AuthError when browser flow times out", async () => {
    await withTmpDir(async (dir) => {
      await expect(
        runLogin({
          configPath: fixture("oauth2-authcode.yml"),
          http: httpMock({}),
          openBrowser: async () => {
            /* never sends callback */
          },
          tokenDir: dir,
          stdout: () => {},
          timeoutMs: 100,
        }),
      ).rejects.toBeInstanceOf(AuthError);
    });
  });

  it("throws AuthError when auth.type is not oauth2_authcode", async () => {
    await withTmpDir(async (dir) => {
      await expect(
        runLogin({
          configPath: fixture("basic-noenv.yml"),
          tokenDir: dir,
          stdout: () => {},
        }),
      ).rejects.toBeInstanceOf(AuthError);
    });
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

```bash
npm test -- --reporter=verbose tests/unit/commands/login.test.ts
```

Expected: the 5 PKCE/state tests still pass; the 4 `runLogin` tests fail because `runLogin` is not exported yet.

- [ ] **Step 3: Complete the implementation in `src/commands/login.ts`**

Replace the entire file with:

```typescript
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { loadConfig } from "../core/config.js";
import { writeToken } from "../core/auth/token-store.js";
import { createHttpClient, type HttpClient } from "../core/http.js";
import { AuthError } from "../errors.js";

const DEFAULT_PORT = 7432;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(96).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(16).toString("base64url");
}

export interface LoginDeps {
  stdout?: (s: string) => void;
  openBrowser?: (url: string) => Promise<void>;
  configPath?: string;
  http?: HttpClient;
  now?: () => number;
  timeoutMs?: number;
  tokenDir?: string;
  _generatePkce?: () => { verifier: string; challenge: string };
  _generateState?: () => string;
}

export async function runLogin(deps: LoginDeps = {}): Promise<void> {
  const stdout = deps.stdout ?? ((s) => process.stdout.write(s + "\n"));
  const configPath = deps.configPath ?? (process.env.DRUPAL_CLI_CONFIG ?? ".drupal-cli.yml");
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = deps.now ?? Date.now;
  const http = deps.http ?? createHttpClient();
  const pkce = (deps._generatePkce ?? generatePkce)();
  const state = (deps._generateState ?? generateState)();

  const cfg = await loadConfig(configPath);
  const { auth, base_url: baseUrl } = cfg.site;

  if (auth.type !== "oauth2_authcode") {
    throw new AuthError("login requires auth.type: oauth2_authcode in config");
  }

  const clientId = auth.client_id;
  if (typeof clientId !== "string" || clientId.length === 0) {
    throw new AuthError("oauth2_authcode auth requires client_id");
  }

  const scope = typeof auth.scope === "string" ? auth.scope : "";
  const port =
    typeof auth.redirect_port === "number" ? auth.redirect_port : DEFAULT_PORT;
  const redirectUri = `http://localhost:${port}/callback`;
  const baseUrlNorm = baseUrl.replace(/\/$/, "");
  const tokenEndpoint = `${baseUrlNorm}/oauth/token`;

  const authUrl = new URL(`${baseUrlNorm}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("code_challenge", pkce.challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  if (scope) authUrl.searchParams.set("scope", scope);

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<html><body><p>Login successful. You can close this tab.</p></body></html>",
      );
      clearTimeout(timer);
      server.close();

      const receivedState = url.searchParams.get("state");
      const receivedCode = url.searchParams.get("code");

      if (receivedState !== state) {
        reject(new AuthError("OAuth state mismatch — possible CSRF attack"));
        return;
      }
      if (!receivedCode) {
        reject(new AuthError("No authorization code received"));
        return;
      }
      resolve(receivedCode);
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new AuthError("Login timed out. Run 'drupal-cli login' to try again."));
    }, timeoutMs);

    server.listen(port, () => {
      stdout("Opening browser for login...");
      stdout(`If the browser does not open, visit:\n${authUrl.toString()}`);

      const openBrowser =
        deps.openBrowser ??
        (async (u: string) => {
          const { default: open } = await import("open");
          await open(u);
        });

      openBrowser(authUrl.toString()).catch(() => {
        /* URL is already printed — ignore open errors */
      });
    });
  });

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: pkce.verifier,
    client_id: clientId,
    redirect_uri: redirectUri,
  });

  const res = await http.send({
    method: "POST",
    url: tokenEndpoint,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const body = JSON.parse(res.body) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof body.access_token !== "string") {
    throw new AuthError("Token endpoint returned no access_token");
  }

  const ttlSec = typeof body.expires_in === "number" ? body.expires_in : 3600;
  const expiresAt = now() + ttlSec * 1000 - 5000;

  const token = {
    access_token: body.access_token,
    ...(typeof body.refresh_token === "string"
      ? { refresh_token: body.refresh_token }
      : {}),
    expires_at: expiresAt,
  };

  await writeToken(baseUrl, token, deps.tokenDir);

  stdout(`Logged in · token valid until ${new Date(expiresAt).toISOString()}`);
}
```

- [ ] **Step 4: Run the full login test suite**

```bash
npm test -- --reporter=verbose tests/unit/commands/login.test.ts
```

Expected: all 9 tests pass (5 pure-function + 4 `runLogin`).

- [ ] **Step 5: Commit**

```bash
git add src/commands/login.ts tests/unit/commands/login.test.ts
git commit -m "feat: runLogin — authorization code flow with PKCE and token storage"
```

---

## Task 7: Wire `login` in `index.ts` and run full test suite

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add the `login` import to `src/index.ts`**

After the existing command imports (around line 14), add:

```typescript
import { runLogin } from "./commands/login.js";
```

- [ ] **Step 2: Register the `login` command inside `buildProgram`**

After the last existing `program.command(...)` block (just before `program.exitOverride()`), add:

```typescript
  program
    .command("login")
    .description("Authenticate via OAuth 2.0 Authorization Code + PKCE")
    .action(async () => {
      try {
        await runLogin({ stdout: (s) => process.stdout.write(s + "\n") });
      } catch (err) {
        output.fail(err);
        setExitCode(exitCodeFor(err));
      }
    });
```

- [ ] **Step 3: Run the complete unit test suite**

```bash
npm test
```

Expected: all tests pass, zero failures.

- [ ] **Step 4: Type-check the full project**

```bash
npm run typecheck
```

Expected: exits 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: register login command in CLI entry point"
```

---

## Self-Review

**Spec coverage:**
- §4 Config Schema → Task 1 (config.ts union) + fixture in Task 5 ✓
- §5 Token Storage → Task 2 (token-store.ts, 0600 perms, mkdir -p, hostname key) ✓
- §6 Login Flow (PKCE, state, server, browser, timeout, token exchange, store, success msg) → Tasks 5+6 ✓
- §7 Token Usage (valid, refresh, no refresh, refresh failure, no file) → Task 3 (all 9 cases) ✓
- §8 File Map → every file accounted for across tasks ✓
- §9 Dependencies (`open`) → Task 1 ✓
- §10 Testing (all three test files, all described cases) → Tasks 2, 3, 5, 6 ✓

**Placeholder scan:** No TBDs or "similar to above" references found.

**Type consistency:**
- `StoredToken` defined in `token-store.ts` Task 2 → imported in `oauth2-authcode.ts` Task 3 and `login.ts` Task 6 ✓
- `OAuth2AuthCodeDeps.tokenDir` matches usage in tests ✓
- `LoginDeps._generatePkce` / `_generateState` match the test injection pattern ✓
- `readToken` / `writeToken` signatures (baseUrl, token, dir?) consistent across all tasks ✓
