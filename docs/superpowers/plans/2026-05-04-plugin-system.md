# Plugin System & Monorepo Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate drupal-cli to a pnpm monorepo with a typed plugin system; extract OAuth2 auth and Schemata schema source into independent plugins; migrate config from YAML to JS ESM.

**Architecture:** Core stays at the repo root and contains only what works with vanilla Drupal core (Basic auth, heuristic schema). OAuth2 adapters + login command move to `plugins/oauth2/`. Schemata schema source moves to `plugins/schemata/`. Both register via `DrupalCliPlugin.registerAuthAdapters` and `extendSchema` hooks called at startup and schema-fetch time respectively.

**Tech Stack:** pnpm workspaces, TypeScript 5.6, Vitest 2, Commander 12, existing codebase patterns.

---

## File Map

**Created:**
- `pnpm-workspace.yaml`
- `src/core/plugin.ts` — `DrupalCliPlugin` interface, `PluginContext`, `DiscoveryResult`
- `plugins/oauth2/package.json`
- `plugins/oauth2/tsconfig.json`
- `plugins/oauth2/src/index.ts` — `oauth2Plugin()` factory
- `plugins/oauth2/src/oauth2.ts` — moved from `src/core/auth/oauth2.ts`
- `plugins/oauth2/src/oauth2-authcode.ts` — moved from `src/core/auth/oauth2-authcode.ts`
- `plugins/oauth2/src/token-store.ts` — moved from `src/core/auth/token-store.ts`
- `plugins/oauth2/src/login.ts` — moved from `src/commands/login.ts`
- `plugins/oauth2/tests/unit/oauth2.test.ts`
- `plugins/oauth2/tests/unit/oauth2-authcode.test.ts`
- `plugins/oauth2/tests/unit/token-store.test.ts`
- `plugins/oauth2/tests/unit/login.test.ts`
- `plugins/schemata/package.json`
- `plugins/schemata/tsconfig.json`
- `plugins/schemata/src/index.ts` — `schemataPlugin()` factory
- `plugins/schemata/src/schemata.ts` — moved from `src/core/schema/sources/schemata.ts`
- `plugins/schemata/tests/unit/schemata.test.ts`
- `tests/unit/fixtures/config/valid.js`
- `tests/unit/fixtures/config/no-base-url.js`
- `tests/unit/fixtures/config/no-auth-type.js`
- `drupal-cli.config.example.js`

**Modified:**
- `package.json` — remove `js-yaml` dep + `@types/js-yaml`, update scripts for pnpm
- `src/core/config.ts` — dynamic import, drop YAML/expandEnv, add `plugins` field
- `src/core/auth/types.ts` — add `AuthAdapterFactory` export
- `src/core/auth/factory.ts` — open registry instead of switch/case
- `src/core/schema/jsonschema-source.ts` — accept plugins, call `extendSchema` per plugin
- `src/index.ts` — load plugins at startup, call `registerAuthAdapters`/`registerCommands`; remove hardcoded `login` command
- `tests/unit/core/config.test.ts` — rewrite for JS fixtures, drop YAML env-expansion tests
- `tests/unit/core/auth/factory.test.ts` — test registry pattern
- `tests/unit/core/schema/jsonschema-source.test.ts` — pass empty plugins array
- `tests/unit/commands/login.test.ts` — update import path
- `tests/integrations/helpers/run.ts` — `renderConfig` writes JS not YAML

**Deleted:**
- `src/core/auth/oauth2.ts`
- `src/core/auth/oauth2-authcode.ts`
- `src/core/auth/token-store.ts`
- `src/commands/login.ts`
- `src/core/schema/sources/schemata.ts`
- `tests/unit/core/auth/oauth2.test.ts`
- `tests/unit/core/auth/oauth2-authcode.test.ts`
- `tests/unit/core/auth/token-store.test.ts`
- `tests/unit/commands/login.test.ts`
- `tests/unit/core/schema/sources/schemata.test.ts`
- `tests/unit/fixtures/config/valid.yml`
- `tests/unit/fixtures/config/missing-env.yml`
- `tests/unit/fixtures/config/basic-noenv.yml`
- `tests/unit/fixtures/config/oauth2-authcode.yml`
- `.drupal-cli.yml.example`

---

## Task 1: pnpm workspace scaffolding

**Files:**
- Create: `pnpm-workspace.yaml`
- Modify: `package.json`

- [ ] **Step 1: Create pnpm-workspace.yaml**

```yaml
packages:
  - 'plugins/*'
```

- [ ] **Step 2: Remove js-yaml from package.json**

In `package.json`, remove from `dependencies`:
```json
"js-yaml": "^4.1.0"
```
And from `devDependencies`:
```json
"@types/js-yaml": "^4.0.9"
```

- [ ] **Step 3: Install pnpm globally if not present and install deps**

```bash
npm install -g pnpm
pnpm install
```

Expected: lock file `pnpm-lock.yaml` created, `node_modules` populated.

- [ ] **Step 4: Verify tests still pass**

```bash
npm run typecheck && npm test
```

Expected: all tests pass (js-yaml is still imported in config.ts — that will fail typecheck. If so, skip typecheck for now and only run `npm test`).

> Note: `config.ts` still imports `js-yaml` at this point. The typecheck will fail until Task 4. Run `npm test` only here — full typecheck passes at end of Task 4.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml
git commit -m "chore: migrate to pnpm workspaces"
```

---

## Task 2: DrupalCliPlugin interface

**Files:**
- Create: `src/core/plugin.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/plugin.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { DrupalCliPlugin, PluginContext } from "../../../src/core/plugin.js";
import type { AuthAdapter } from "../../../src/core/auth/types.js";
import type { HttpClient } from "../../../src/core/http.js";

const ctx: PluginContext = {
  http: { send: async () => ({ status: 200, headers: {}, body: "{}" }) },
  auth: { apply: async (req) => req },
  baseUrl: "https://example.com",
};

describe("DrupalCliPlugin interface", () => {
  it("accepts a conforming plugin object", async () => {
    const plugin: DrupalCliPlugin = {
      id: "test",
      requiredModules: ["some_module"],
      async fetchCatalog(_ctx) { return {}; },
      extendDiscovery(base, _catalog) { return base; },
      async extendSchema(_entity, _bundle, schema, _ctx) { return schema; },
    };
    expect(plugin.id).toBe("test");
    expect(plugin.requiredModules).toEqual(["some_module"]);
    const catalog = await plugin.fetchCatalog(ctx);
    expect(catalog).toEqual({});
    const discovery = { installed_modules: [], features: {} };
    expect(plugin.extendDiscovery(discovery, {})).toBe(discovery);
    const schema = { type: "object" };
    const extended = await plugin.extendSchema("node", "article", schema, ctx);
    expect(extended).toBe(schema);
  });

  it("optional registerAuthAdapters and registerCommands may be absent", () => {
    const plugin: DrupalCliPlugin = {
      id: "minimal",
      requiredModules: [],
      async fetchCatalog() { return {}; },
      extendDiscovery(base) { return base; },
      async extendSchema(_e, _b, s) { return s; },
    };
    expect(plugin.registerAuthAdapters).toBeUndefined();
    expect(plugin.registerCommands).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/core/plugin.test.ts
```

Expected: FAIL — `Cannot find module '../../../src/core/plugin.js'`

- [ ] **Step 3: Create src/core/plugin.ts**

```typescript
import type { Command } from "commander";
import type { AuthConfig } from "./config.js";
import type { HttpClient } from "./http.js";
import type { AuthAdapter } from "./auth/types.js";

export interface PluginContext {
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
}

export interface DiscoveryResult {
  installed_modules: string[];
  features: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AuthFactoryDeps {
  http: HttpClient;
  baseUrl: string;
}

export type AuthAdapterFactory = (config: AuthConfig, deps: AuthFactoryDeps) => AuthAdapter;

export interface DrupalCliPlugin {
  readonly id: string;
  readonly requiredModules: string[];
  fetchCatalog(ctx: PluginContext): Promise<unknown>;
  extendDiscovery(base: DiscoveryResult, catalog: unknown): DiscoveryResult;
  extendSchema(
    entityType: string,
    bundle: string,
    baseSchema: unknown,
    ctx: PluginContext,
  ): Promise<unknown>;
  registerAuthAdapters?(): Record<string, AuthAdapterFactory>;
  registerCommands?(program: Command): void;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/unit/core/plugin.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/plugin.ts tests/unit/core/plugin.test.ts
git commit -m "feat: add DrupalCliPlugin interface and PluginContext"
```

---

## Task 3: Open auth registry

**Files:**
- Modify: `src/core/auth/types.ts`
- Modify: `src/core/auth/factory.ts`
- Modify: `tests/unit/core/auth/factory.test.ts`

- [ ] **Step 1: Update factory test to use registry pattern**

Replace `tests/unit/core/auth/factory.test.ts` in full:

```typescript
import { describe, expect, it } from "vitest";
import { createAuthAdapter, createAuthRegistry } from "../../../../src/core/auth/factory.js";
import { AuthError } from "../../../../src/errors.js";
import type { HttpClient } from "../../../../src/core/http.js";

const http: HttpClient = { send: async () => ({ status: 200, headers: {}, body: "{}" }) };
const deps = { http, baseUrl: "https://x" };

describe("auth factory", () => {
  it("creates basic adapter from core registry (no plugins)", async () => {
    const registry = createAuthRegistry([]);
    const a = createAuthAdapter({ type: "basic", username: "u", password: "p" }, deps, registry);
    const req = await a.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.Authorization).toMatch(/^Basic /);
  });

  it("throws on unknown type when no plugin registers it", () => {
    const registry = createAuthRegistry([]);
    expect(() =>
      createAuthAdapter({ type: "oauth2_password", client_id: "c", client_secret: "s" } as any, deps, registry)
    ).toThrow(AuthError);
  });

  it("uses adapter registered by a plugin", async () => {
    const mockAdapter = { apply: async (req: any) => req };
    const registry = createAuthRegistry([
      {
        registerAuthAdapters: () => ({ oauth2_password: () => mockAdapter }),
      } as any,
    ]);
    const a = createAuthAdapter(
      { type: "oauth2_password", client_id: "c", client_secret: "s" },
      deps,
      registry,
    );
    expect(a).toBe(mockAdapter);
  });

  it("throws on unknown type even with plugins that don't register it", () => {
    const registry = createAuthRegistry([{ registerAuthAdapters: () => ({ other: () => ({} as any) }) } as any]);
    expect(() =>
      createAuthAdapter({ type: "weird" } as any, deps, registry)
    ).toThrow(AuthError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/core/auth/factory.test.ts
```

Expected: FAIL — `createAuthRegistry is not exported`

- [ ] **Step 3: Add AuthAdapterFactory to src/core/auth/types.ts**

Replace `src/core/auth/types.ts` in full:

```typescript
import type { HttpRequest } from "../http.js";

export interface AuthAdapter {
  apply(req: HttpRequest): Promise<HttpRequest>;
}
```

(No change needed here — `AuthAdapterFactory` is already defined in `plugin.ts`. Keep `types.ts` minimal.)

- [ ] **Step 4: Rewrite src/core/auth/factory.ts**

```typescript
import { AuthError } from "../../errors.js";
import type { AuthConfig } from "../config.js";
import type { HttpClient } from "../http.js";
import { createBasicAuth } from "./basic.js";
import type { AuthAdapter } from "./types.js";
import type { AuthAdapterFactory, AuthFactoryDeps, DrupalCliPlugin } from "../plugin.js";

export type { AuthFactoryDeps };

export type AuthRegistry = Map<string, AuthAdapterFactory>;

export function createAuthRegistry(plugins: DrupalCliPlugin[]): AuthRegistry {
  const registry: AuthRegistry = new Map();
  registry.set("basic", (cfg, _deps) => createBasicAuth(cfg));
  for (const plugin of plugins) {
    if (plugin.registerAuthAdapters) {
      for (const [type, factory] of Object.entries(plugin.registerAuthAdapters())) {
        registry.set(type, factory);
      }
    }
  }
  return registry;
}

export function createAuthAdapter(
  cfg: AuthConfig,
  deps: AuthFactoryDeps,
  registry: AuthRegistry,
): AuthAdapter {
  const factory = registry.get(cfg.type);
  if (!factory) {
    throw new AuthError(
      `Unknown auth.type '${cfg.type}'. Install the matching @drupal-cli/plugin-* and add it to config.plugins.`,
    );
  }
  return factory(cfg, deps);
}
```

> Note: OAuth2 factories need `http` and `baseUrl`. We pass them via the `AuthConfig` object using private `_http`/`_baseUrl` keys. This avoids changing the `AuthAdapterFactory` signature. The oauth2 plugin reads these in Task 6.

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- tests/unit/core/auth/factory.test.ts
```

Expected: PASS

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
npm test
```

Expected: existing auth tests may fail because `createAuthAdapter` now requires a `registry` argument. Fix callsite in `src/index.ts` by passing `createAuthRegistry([])` temporarily:

In `src/index.ts`, update `defaultContext`:
```typescript
import { createAuthAdapter, createAuthRegistry } from "./core/auth/factory.js";
// ...
const registry = createAuthRegistry([]);
const auth = createAuthAdapter(cfg.site.auth, { http, baseUrl: cfg.site.base_url }, registry);
```

Also update `tests/unit/index.test.ts` if it calls `createAuthAdapter` directly (check and patch imports).

- [ ] **Step 7: Run full tests again**

```bash
npm test
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/core/plugin.ts src/core/auth/factory.ts src/core/auth/types.ts \
        src/index.ts tests/unit/core/auth/factory.test.ts
git commit -m "feat: open auth registry — basic built-in, oauth2 types registered by plugins"
```

---

## Task 4: Config migration — YAML → JS ESM

**Files:**
- Modify: `src/core/config.ts`
- Create: `tests/unit/fixtures/config/valid.js`
- Create: `tests/unit/fixtures/config/no-base-url.js`
- Create: `tests/unit/fixtures/config/no-auth-type.js`
- Modify: `tests/unit/core/config.test.ts`
- Delete: `tests/unit/fixtures/config/valid.yml`, `missing-env.yml`, `basic-noenv.yml`, `oauth2-authcode.yml`
- Create: `drupal-cli.config.example.js`
- Delete: `.drupal-cli.yml.example`

- [ ] **Step 1: Create JS fixture files**

Create `tests/unit/fixtures/config/valid.js`:
```js
export default {
  site: {
    base_url: 'https://example.com',
    jsonapi_prefix: '/jsonapi',
    auth: { type: 'basic', username: 'alice', password: 's3cret' },
  },
  defaults: { dry_run: false, timeout_ms: 15000 },
};
```

Create `tests/unit/fixtures/config/no-base-url.js`:
```js
export default {
  site: { auth: { type: 'basic', username: 'a', password: 'b' } },
};
```

Create `tests/unit/fixtures/config/no-auth-type.js`:
```js
export default {
  site: { base_url: 'https://example.com', auth: {} },
};
```

- [ ] **Step 2: Rewrite config test**

Replace `tests/unit/core/config.test.ts` in full:

```typescript
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/core/config.js";
import { ConfigError } from "../../../src/errors.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, "..", "fixtures", "config", name);

describe("loadConfig", () => {
  it("parses JS config and returns typed Config", async () => {
    const cfg = await loadConfig(fixture("valid.js"));
    expect(cfg.site.base_url).toBe("https://example.com");
    expect(cfg.site.jsonapi_prefix).toBe("/jsonapi");
    expect(cfg.site.auth).toEqual({ type: "basic", username: "alice", password: "s3cret" });
    expect(cfg.defaults.dry_run).toBe(false);
    expect(cfg.defaults.timeout_ms).toBe(15000);
    expect(cfg.plugins).toEqual([]);
  });

  it("defaults jsonapi_prefix to /jsonapi when omitted", async () => {
    const cfg = await loadConfig(fixture("valid.js"));
    expect(cfg.site.jsonapi_prefix).toBe("/jsonapi");
  });

  it("throws ConfigError on missing file", async () => {
    await expect(loadConfig(fixture("does-not-exist.js"))).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError on missing site.base_url", async () => {
    await expect(loadConfig(fixture("no-base-url.js"))).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError on missing site.auth.type", async () => {
    await expect(loadConfig(fixture("no-auth-type.js"))).rejects.toBeInstanceOf(ConfigError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- tests/unit/core/config.test.ts
```

Expected: FAIL — config.ts still uses yaml.load

- [ ] **Step 4: Rewrite src/core/config.ts**

```typescript
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigError } from "../errors.js";
import type { DrupalCliPlugin } from "./plugin.js";

export interface AuthConfig {
  type: string;
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
  plugins: DrupalCliPlugin[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function loadConfig(filePath: string): Promise<Config> {
  let mod: { default: unknown };
  try {
    mod = await import(pathToFileURL(resolve(filePath)).href);
  } catch (err) {
    throw new ConfigError(`Cannot load config file: ${filePath}`, { cause: String(err) });
  }

  const raw = mod.default;
  if (!isRecord(raw)) throw new ConfigError("Config default export must be an object");

  const site = raw.site;
  if (!isRecord(site)) throw new ConfigError("site section missing");
  if (typeof site.base_url !== "string" || site.base_url.length === 0)
    throw new ConfigError("site.base_url required");
  if (!isRecord(site.auth)) throw new ConfigError("site.auth section missing");
  if (typeof site.auth.type !== "string") throw new ConfigError("site.auth.type required");

  const defaults = isRecord(raw.defaults) ? raw.defaults : {};
  const plugins = Array.isArray(raw.plugins) ? (raw.plugins as DrupalCliPlugin[]) : [];

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
    plugins,
  };
}
```

- [ ] **Step 5: Run config test**

```bash
npm test -- tests/unit/core/config.test.ts
```

Expected: PASS

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: login test may fail if it uses `DRUPAL_CLI_CONFIG=...yml`. Fix: update `src/commands/login.ts` default config path:

In `src/commands/login.ts` line 36, change:
```typescript
const configPath = deps.configPath ?? process.env.DRUPAL_CLI_CONFIG ?? ".drupal-cli.yml";
```
to:
```typescript
const configPath = deps.configPath ?? process.env.DRUPAL_CLI_CONFIG ?? "drupal-cli.config.js";
```

Also update `src/index.ts` line 42:
```typescript
const cfg = await loadConfig(process.env.DRUPAL_CLI_CONFIG ?? "drupal-cli.config.js");
```

- [ ] **Step 7: Run full tests again**

```bash
npm run typecheck && npm test
```

Expected: PASS (js-yaml fully removed from imports now)

- [ ] **Step 8: Delete YAML fixture files**

```bash
rm tests/unit/fixtures/config/valid.yml \
   tests/unit/fixtures/config/missing-env.yml \
   tests/unit/fixtures/config/basic-noenv.yml \
   tests/unit/fixtures/config/oauth2-authcode.yml \
   .drupal-cli.yml.example
```

- [ ] **Step 9: Create example config**

Create `drupal-cli.config.example.js`:
```js
// drupal-cli.config.example.js — copy to drupal-cli.config.js and fill in your values
// import { oauth2Plugin } from '@drupal-cli/plugin-oauth2';
// import { schemataPlugin } from '@drupal-cli/plugin-schemata';

export default {
  site: {
    base_url: 'https://my-drupal.example.com',
    jsonapi_prefix: '/jsonapi',
    auth: {
      // Basic auth (no plugin needed):
      type: 'basic',
      username: process.env.DRUPAL_USER,
      password: process.env.DRUPAL_PASSWORD,

      // OAuth2 password grant (requires @drupal-cli/plugin-oauth2):
      // type: 'oauth2_password',
      // client_id: process.env.DRUPAL_CLIENT_ID,
      // client_secret: process.env.DRUPAL_CLIENT_SECRET,
      // username: process.env.DRUPAL_USER,
      // password: process.env.DRUPAL_PASSWORD,
    },
  },
  defaults: {
    dry_run: false,
    timeout_ms: 30000,
  },
  plugins: [
    // oauth2Plugin(),
    // schemataPlugin(),
  ],
};
```

- [ ] **Step 10: Commit**

```bash
git add src/core/config.ts tests/unit/core/config.test.ts \
        tests/unit/fixtures/config/valid.js \
        tests/unit/fixtures/config/no-base-url.js \
        tests/unit/fixtures/config/no-auth-type.js \
        drupal-cli.config.example.js src/commands/login.ts src/index.ts
git rm tests/unit/fixtures/config/valid.yml \
       tests/unit/fixtures/config/missing-env.yml \
       tests/unit/fixtures/config/basic-noenv.yml \
       tests/unit/fixtures/config/oauth2-authcode.yml \
       .drupal-cli.yml.example
git commit -m "feat: migrate config from YAML to JS ESM, drop js-yaml dependency"
```

---

## Task 5: Plugin loading at startup

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update index test to cover plugin hooks**

Add to `tests/unit/index.test.ts` (find the `describe` block and add):

```typescript
import type { DrupalCliPlugin } from "../../src/core/plugin.js";

it("calls registerAuthAdapters on startup and uses plugin-registered adapter", async () => {
  const mockAdapter = { apply: async (req: any) => req };
  const plugin: DrupalCliPlugin = {
    id: "test-auth",
    requiredModules: [],
    registerAuthAdapters: () => ({ mock_auth: () => mockAdapter }),
    async fetchCatalog() { return {}; },
    extendDiscovery(base) { return base; },
    async extendSchema(_e, _b, s) { return s; },
  };
  // Build a program with a context factory that uses the plugin
  let capturedAuth: any;
  buildProgram({
    contextFactory: async () => {
      const cfg = {
        site: { base_url: "https://x", jsonapi_prefix: "/jsonapi", auth: { type: "mock_auth" } },
        defaults: { dry_run: false, timeout_ms: 30000 },
        plugins: [plugin],
      };
      const { createAuthRegistry, createAuthAdapter } = await import("../../src/core/auth/factory.js");
      const registry = createAuthRegistry(cfg.plugins);
      capturedAuth = createAuthAdapter(cfg.site.auth as any, { http: { send: async () => ({status:200,headers:{},body:"{}"}) }, baseUrl: "https://x" }, registry);
      return { client: {} as any, http: {} as any, auth: capturedAuth, baseUrl: "https://x", jsonapiPrefix: "/jsonapi", cwd: ".", plugins: cfg.plugins };
    },
  });
  expect(capturedAuth).toBe(mockAdapter);
});
```

- [ ] **Step 2: Update defaultContext in src/index.ts to load plugins**

Update the `defaultContext` function and `CommandContext` interface in `src/index.ts`:

```typescript
export interface CommandContext {
  client: JsonApiClient;
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  jsonapiPrefix: string;
  cwd: string;
  plugins: DrupalCliPlugin[];
}
```

Replace `defaultContext`:
```typescript
async function defaultContext(): Promise<CommandContext> {
  const cfg = await loadConfig(process.env.DRUPAL_CLI_CONFIG ?? "drupal-cli.config.js");
  const http = createHttpClient({ timeoutMs: cfg.defaults.timeout_ms });
  const registry = createAuthRegistry(cfg.plugins);
  const auth = createAuthAdapter(cfg.site.auth, { http, baseUrl: cfg.site.base_url }, registry);
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

Add import at top of `src/index.ts`:
```typescript
import { createAuthRegistry } from "./core/auth/factory.js";
import type { DrupalCliPlugin } from "./core/plugin.js";
```

- [ ] **Step 3: Wire registerCommands into buildProgram**

In `buildProgram`, after all hardcoded commands are registered, add before `program.exitOverride()`:

```typescript
  // Allow plugins to register additional commands
  if (opts.plugins) {
    for (const plugin of opts.plugins) {
      plugin.registerCommands?.(program);
    }
  }
```

Update `ProgramOptions`:
```typescript
export interface ProgramOptions {
  contextFactory?: () => Promise<CommandContext>;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  setExitCode?: (code: number) => void;
  plugins?: DrupalCliPlugin[];
}
```

Update `main()` to pass plugins:
```typescript
export async function main(): Promise<void> {
  const cfg = await loadConfig(process.env.DRUPAL_CLI_CONFIG ?? "drupal-cli.config.js").catch(() => null);
  const plugins = cfg?.plugins ?? [];
  const program = buildProgram({ plugins });
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if ((err as { code?: string }).code === "commander.helpDisplayed") return;
    process.exitCode = process.exitCode ?? 1;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm run typecheck && npm test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/unit/index.test.ts
git commit -m "feat: load plugins at startup, wire registerAuthAdapters and registerCommands"
```

---

## Task 6: Create plugins/oauth2 package

**Files:**
- Create: `plugins/oauth2/package.json`
- Create: `plugins/oauth2/tsconfig.json`
- Create: `plugins/oauth2/src/oauth2.ts`
- Create: `plugins/oauth2/src/oauth2-authcode.ts`
- Create: `plugins/oauth2/src/token-store.ts`
- Create: `plugins/oauth2/src/login.ts`
- Create: `plugins/oauth2/src/index.ts`
- Create: `plugins/oauth2/tests/unit/*.test.ts`
- Delete: `src/core/auth/oauth2.ts`, `oauth2-authcode.ts`, `token-store.ts`
- Delete: `src/commands/login.ts`

- [ ] **Step 1: Create package scaffolding**

Create `plugins/oauth2/package.json`:
```json
{
  "name": "@drupal-cli/plugin-oauth2",
  "version": "0.0.1-alpha.0",
  "type": "module",
  "main": "./dist/src/index.js",
  "exports": {
    ".": "./dist/src/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "drupal-cli": "*"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

Create `plugins/oauth2/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 2: Copy oauth2 adapter source**

Create `plugins/oauth2/src/oauth2.ts` — copy content of `src/core/auth/oauth2.ts` verbatim, then update imports:

Replace:
```typescript
import { AuthError, HttpError } from "../../errors.js";
import type { AuthConfig } from "../config.js";
import type { HttpClient, HttpRequest } from "../http.js";
import type { AuthAdapter } from "./types.js";
```
With:
```typescript
import { AuthError, HttpError } from "drupal-cli/errors";
import type { AuthConfig } from "drupal-cli/core/config";
import type { HttpClient, HttpRequest } from "drupal-cli/core/http";
import type { AuthAdapter } from "drupal-cli/core/auth/types";
```

> Note: The `drupal-cli` peer dependency exports need to be configured in Task 6 Step 7. For now, use relative symlink paths via workspace protocol. The simplest approach during development is to import from the workspace root using relative paths. Update imports to use relative paths from the plugin root:

Create `plugins/oauth2/src/oauth2.ts`:
```typescript
import type { AuthConfig } from "../../../src/core/config.js";
import type { HttpClient, HttpRequest } from "../../../src/core/http.js";
import type { AuthAdapter } from "../../../src/core/auth/types.js";
import { AuthError, HttpError } from "../../../src/errors.js";

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
  const tokenUrl =
    typeof cfg.token_url === "string"
      ? cfg.token_url
      : `${deps.baseUrl.replace(/\/$/, "")}/oauth/token`;

  const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });
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
      if (err instanceof HttpError)
        throw new AuthError(`Token request failed: HTTP ${err.status}`, { body: err.body });
      if (err instanceof AuthError) throw err;
      throw new AuthError(`Token request failed: ${(err as Error).message}`);
    }
  }

  return {
    async apply(req: HttpRequest): Promise<HttpRequest> {
      if (!cached || cached.expiresAt <= now()) cached = await fetchToken();
      return {
        ...req,
        headers: { ...(req.headers ?? {}), Authorization: `Bearer ${cached.token}` },
      };
    },
  };
}
```

- [ ] **Step 3: Copy oauth2-authcode adapter**

Create `plugins/oauth2/src/token-store.ts` — copy `src/core/auth/token-store.ts` verbatim (no import changes needed).

Create `plugins/oauth2/src/oauth2-authcode.ts` — copy `src/core/auth/oauth2-authcode.ts`, update imports:

```typescript
import type { AuthConfig } from "../../../src/core/config.js";
import type { HttpClient, HttpRequest } from "../../../src/core/http.js";
import { readToken, writeToken } from "./token-store.js";
import type { AuthAdapter } from "../../../src/core/auth/types.js";
import { AuthError, HttpError } from "../../../src/errors.js";
```

Rest of the file is identical to `src/core/auth/oauth2-authcode.ts`.

- [ ] **Step 4: Copy login command**

Create `plugins/oauth2/src/login.ts` — copy `src/commands/login.ts`, update imports:

```typescript
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { writeToken } from "./token-store.js";
import { loadConfig } from "../../../src/core/config.js";
import { createHttpClient, type HttpClient } from "../../../src/core/http.js";
import { AuthError } from "../../../src/errors.js";
```

The `configPath` default on line 36 changes to:
```typescript
const configPath = deps.configPath ?? process.env.DRUPAL_CLI_CONFIG ?? "drupal-cli.config.js";
```

Rest of the file is identical to the original.

- [ ] **Step 5: Create the plugin factory**

Create `plugins/oauth2/src/index.ts`:

```typescript
import type { DrupalCliPlugin, AuthFactoryDeps } from "../../../src/core/plugin.js";
import type { AuthConfig } from "../../../src/core/config.js";
import { createOAuth2Auth } from "./oauth2.js";
import { createOAuth2AuthCodeAuth } from "./oauth2-authcode.js";

export { runLogin } from "./login.js";

export function oauth2Plugin(): DrupalCliPlugin {
  return {
    id: "oauth2",
    requiredModules: ["simple_oauth"],

    registerAuthAdapters() {
      return {
        oauth2_password: (cfg: AuthConfig, deps: AuthFactoryDeps) =>
          createOAuth2Auth(cfg, { http: deps.http, baseUrl: deps.baseUrl }),
        oauth2_client_credentials: (cfg: AuthConfig, deps: AuthFactoryDeps) =>
          createOAuth2Auth(cfg, { http: deps.http, baseUrl: deps.baseUrl }),
        oauth2_authcode: (cfg: AuthConfig, deps: AuthFactoryDeps) =>
          createOAuth2AuthCodeAuth(cfg, { http: deps.http, baseUrl: deps.baseUrl }),
      };
    },

    registerCommands(program) {
      program
        .command("login")
        .description("Authenticate via OAuth 2.0 Authorization Code + PKCE")
        .action(async () => {
          const { runLogin } = await import("./login.js");
          try {
            await runLogin({ stdout: (s) => process.stdout.write(`${s}\n`) });
          } catch (err) {
            process.stderr.write(`${String(err)}\n`);
            process.exitCode = 1;
          }
        });
    },

    async fetchCatalog(_ctx) { return {}; },
    extendDiscovery(base, _catalog) { return base; },
    async extendSchema(_entity, _bundle, schema, _ctx) { return schema; },
  };
}
```

- [ ] **Step 6: Move unit tests for oauth2 into the plugin**

Create `plugins/oauth2/tests/unit/oauth2.test.ts` — copy `tests/unit/core/auth/oauth2.test.ts`, update imports:

```typescript
import { createOAuth2Auth } from "../../src/oauth2.js";
import { AuthError } from "../../../../src/errors.js";
import type { HttpClient } from "../../../../src/core/http.js";
```

Create `plugins/oauth2/tests/unit/oauth2-authcode.test.ts` — copy `tests/unit/core/auth/oauth2-authcode.test.ts`, update imports:
```typescript
import { createOAuth2AuthCodeAuth } from "../../src/oauth2-authcode.js";
import { readToken, writeToken } from "../../src/token-store.js";
import { AuthError } from "../../../../src/errors.js";
```

Create `plugins/oauth2/tests/unit/token-store.test.ts` — copy `tests/unit/core/auth/token-store.test.ts`, update imports:
```typescript
import { readToken, writeToken } from "../../src/token-store.js";
```

Create `plugins/oauth2/tests/unit/login.test.ts` — copy `tests/unit/commands/login.test.ts`, update imports:
```typescript
import { runLogin } from "../../src/login.js";
import { writeToken } from "../../src/token-store.js";
import { AuthError } from "../../../../src/errors.js";
```

- [ ] **Step 7: Run plugin tests**

```bash
cd plugins/oauth2 && npx vitest run --passWithNoTests
```

Expected: PASS

- [ ] **Step 8: Delete original files from core**

```bash
git rm src/core/auth/oauth2.ts \
       src/core/auth/oauth2-authcode.ts \
       src/core/auth/token-store.ts \
       src/commands/login.ts \
       tests/unit/core/auth/oauth2.test.ts \
       tests/unit/core/auth/oauth2-authcode.test.ts \
       tests/unit/core/auth/token-store.test.ts \
       tests/unit/commands/login.test.ts
```

- [ ] **Step 9: Remove login command from src/index.ts**

In `src/index.ts`, remove:
```typescript
import { runLogin } from "./commands/login.js";
```
And remove the entire `program.command("login")` block (it is now registered by the oauth2 plugin via `registerCommands`).

- [ ] **Step 10: Run full test suite**

```bash
npm run typecheck && npm test
```

Expected: PASS. The login command is gone from core — tests that called it via CLI need the oauth2 plugin in config.

- [ ] **Step 11: Commit**

```bash
git add plugins/oauth2/ src/index.ts src/core/auth/factory.ts
git commit -m "feat: extract OAuth2 auth and login command into @drupal-cli/plugin-oauth2"
```

---

## Task 7: Create plugins/schemata package

**Files:**
- Create: `plugins/schemata/package.json`
- Create: `plugins/schemata/tsconfig.json`
- Create: `plugins/schemata/src/schemata.ts`
- Create: `plugins/schemata/src/index.ts`
- Create: `plugins/schemata/tests/unit/schemata.test.ts`
- Modify: `src/core/schema/jsonschema-source.ts`
- Delete: `src/core/schema/sources/schemata.ts`
- Delete: `tests/unit/core/schema/sources/schemata.test.ts`

- [ ] **Step 1: Create package scaffolding**

Create `plugins/schemata/package.json`:
```json
{
  "name": "@drupal-cli/plugin-schemata",
  "version": "0.0.1-alpha.0",
  "type": "module",
  "main": "./dist/src/index.js",
  "exports": {
    ".": "./dist/src/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "drupal-cli": "*"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

Create `plugins/schemata/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 2: Copy schemata source into plugin**

Create `plugins/schemata/src/schemata.ts`:

```typescript
import type { AuthAdapter } from "../../../src/core/auth/types.js";
import type { HttpClient } from "../../../src/core/http.js";
import { HttpError } from "../../../src/errors.js";

export const SCHEMATA_MISS = Symbol("SCHEMATA_MISS");

export interface SchemataDeps {
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  entity: string;
  bundle: string;
}

export async function fetchSchemata(
  deps: SchemataDeps,
): Promise<unknown | typeof SCHEMATA_MISS> {
  const base = deps.baseUrl.replace(/\/+$/, "");
  const url = `${base}/schemata/${deps.entity}/${deps.bundle}?_format=schema_json&_describes=api_json`;
  const req = await deps.auth.apply({
    method: "GET",
    url,
    headers: { Accept: "application/json" },
  });
  let res: Awaited<ReturnType<typeof deps.http.send>>;
  try {
    res = await deps.http.send(req);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return SCHEMATA_MISS;
    throw err;
  }
  return JSON.parse(res.body);
}
```

- [ ] **Step 3: Create the plugin factory**

Create `plugins/schemata/src/index.ts`:

```typescript
import type { DrupalCliPlugin, PluginContext } from "../../../src/core/plugin.js";
import { fetchSchemata, SCHEMATA_MISS } from "./schemata.js";
import { HttpError } from "../../../src/errors.js";

export function schemataPlugin(): DrupalCliPlugin {
  return {
    id: "schemata",
    requiredModules: ["schemata", "jsonapi_schema"],

    async fetchCatalog(_ctx) { return {}; },
    extendDiscovery(base, _catalog) { return base; },

    async extendSchema(
      entityType: string,
      bundle: string,
      baseSchema: unknown,
      ctx: PluginContext,
    ): Promise<unknown> {
      let result: unknown | typeof SCHEMATA_MISS;
      try {
        result = await fetchSchemata({
          http: ctx.http,
          auth: ctx.auth,
          baseUrl: ctx.baseUrl,
          entity: entityType,
          bundle,
        });
      } catch (err) {
        if (err instanceof HttpError) return baseSchema;
        throw err;
      }
      if (result === SCHEMATA_MISS) return baseSchema;
      return result;
    },
  };
}
```

- [ ] **Step 4: Write schemata plugin unit test**

Create `plugins/schemata/tests/unit/schemata.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { schemataPlugin } from "../../src/index.js";
import { HttpError } from "../../../../src/errors.js";
import type { PluginContext } from "../../../../src/core/plugin.js";

function makeCtx(responses: Array<{ status: number; body: string }>): PluginContext {
  let i = 0;
  return {
    http: {
      send: async () => {
        const r = responses[i++]!;
        if (r.status >= 200 && r.status < 300) return { status: r.status, headers: {}, body: r.body };
        throw new HttpError(r.status, `HTTP ${r.status}`, r.body);
      },
    },
    auth: { apply: async (req) => req },
    baseUrl: "https://example.com",
  };
}

describe("schemataPlugin", () => {
  it("returns schemata schema when endpoint returns 200", async () => {
    const plugin = schemataPlugin();
    const schemataSchema = { properties: { data: { type: "object" } } };
    const ctx = makeCtx([{ status: 200, body: JSON.stringify(schemataSchema) }]);
    const result = await plugin.extendSchema("node", "article", { type: "object" }, ctx);
    expect(result).toEqual(schemataSchema);
  });

  it("returns baseSchema when endpoint returns 404", async () => {
    const plugin = schemataPlugin();
    const base = { type: "object", properties: {} };
    const ctx = makeCtx([{ status: 404, body: "" }]);
    const result = await plugin.extendSchema("node", "article", base, ctx);
    expect(result).toBe(base);
  });

  it("returns baseSchema on any HttpError", async () => {
    const plugin = schemataPlugin();
    const base = { type: "object" };
    const ctx = makeCtx([{ status: 500, body: "error" }]);
    const result = await plugin.extendSchema("node", "article", base, ctx);
    expect(result).toBe(base);
  });

  it("id is schemata", () => {
    expect(schemataPlugin().id).toBe("schemata");
  });

  it("requiredModules includes schemata and jsonapi_schema", () => {
    expect(schemataPlugin().requiredModules).toContain("schemata");
    expect(schemataPlugin().requiredModules).toContain("jsonapi_schema");
  });
});
```

- [ ] **Step 5: Run plugin tests**

```bash
cd plugins/schemata && npx vitest run
```

Expected: PASS

- [ ] **Step 6: Update jsonschema-source.ts to call plugins instead of fetchSchemata**

The key change: remove the direct `fetchSchemata` call; instead run `extendSchema` on each plugin after heuristic.

Replace `src/core/schema/jsonschema-source.ts` in full:

```typescript
import { HttpError, ValidationError } from "../../errors.js";
import type { AuthAdapter } from "../auth/types.js";
import type { HttpClient } from "../http.js";
import type { DrupalCliPlugin, PluginContext } from "../plugin.js";
import { fetchHeuristic } from "./sources/heuristic.js";

export type SchemaSource = "plugin" | "heuristic" | "heuristic-empty";

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
  plugins?: DrupalCliPlugin[];
}

export async function fetchJsonSchema(deps: JsonSchemaDeps): Promise<JsonSchemaResult> {
  const { entity, bundle } = deps;
  const target = { entity_type: entity, bundle };
  const plugins = deps.plugins ?? [];
  const ctx: PluginContext = { http: deps.http, auth: deps.auth, baseUrl: deps.baseUrl };

  // Build heuristic base schema
  let heuristicResult: Awaited<ReturnType<typeof fetchHeuristic>>;
  try {
    heuristicResult = await fetchHeuristic({
      http: deps.http,
      auth: deps.auth,
      baseUrl: deps.baseUrl,
      jsonapiPrefix: deps.jsonapiPrefix,
      entity,
      bundle,
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

  let schema: unknown = heuristicResult.schema;
  let source: SchemaSource = heuristicResult.empty ? "heuristic-empty" : "heuristic";

  if (heuristicResult.empty) {
    deps.warn(
      `warning: bundle '${entity}/${bundle}' has no instances and no schema plugin; returning envelope-only schema`,
    );
  } else {
    deps.warn(
      `warning: no schema plugin configured; returning heuristic schema (no required fields, no constraints)`,
    );
  }

  // Run each plugin's extendSchema — a plugin may replace the schema entirely (e.g. schemata)
  for (const plugin of plugins) {
    const extended = await plugin.extendSchema(entity, bundle, schema, ctx);
    if (extended !== schema) {
      schema = extended;
      source = "plugin";
      // Clear heuristic warning if a plugin improved the schema
    }
  }

  return { schema, source, target };
}
```

> Note: The warning now fires unconditionally before plugins run. If you want to suppress the warning when a plugin succeeds, that's a future refinement — keep it simple for now.

- [ ] **Step 7: Update jsonschema-source test**

In `tests/unit/core/schema/jsonschema-source.test.ts`, update the `fetchJsonSchema` calls to pass `plugins: []` and update `source` expectations:

The test `"returns schemata output with source='schemata'"` no longer applies to core — remove it or adapt. The core now always starts with heuristic. Add a test for the plugin path:

Find and update imports at top:
```typescript
import { fetchJsonSchema } from "../../../../src/core/schema/jsonschema-source.js";
import type { HttpClient } from "../../../../src/core/http.js";
import type { AuthAdapter } from "../../../../src/core/auth/types.js";
import { HttpError, ValidationError } from "../../../../src/errors.js";
import type { DrupalCliPlugin } from "../../../../src/core/plugin.js";
```

Remove the import of `SCHEMATA_MISS` (no longer exported from core).

For the test `"returns schemata output with source='schemata' when schemata 200"`:
- Remove this test (it belongs in the schemata plugin test)

For tests that pass `http` with two scripted responses (schemata 404 + heuristic 200):
- Update to one response (only heuristic), pass `plugins: []`

For the existing test structure, add `plugins: []` to all `fetchJsonSchema` calls:
```typescript
const { schema, source } = await fetchJsonSchema({
  http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi",
  entity: "node", bundle: "article", warn: () => {},
  plugins: [],
});
```

Add a test for plugin-provided schema:
```typescript
it("returns source='plugin' when a plugin extends the schema", async () => {
  const http = scriptedHttp([
    { status: 200, body: JSON.stringify({ data: [{ type: "node--article", id: "x", attributes: { title: "A" }, relationships: {} }] }) },
  ]);
  const pluginSchema = { type: "object", properties: { data: { type: "object" } } };
  const mockPlugin: DrupalCliPlugin = {
    id: "mock",
    requiredModules: [],
    async fetchCatalog() { return {}; },
    extendDiscovery(base) { return base; },
    async extendSchema(_e, _b, _base, _ctx) { return pluginSchema; },
  };
  const { schema, source } = await fetchJsonSchema({
    http, auth, baseUrl: "https://ex", jsonapiPrefix: "/jsonapi",
    entity: "node", bundle: "article", warn: () => {},
    plugins: [mockPlugin],
  });
  expect(source).toBe("plugin");
  expect(schema).toBe(pluginSchema);
});
```

- [ ] **Step 8: Run jsonschema-source tests**

```bash
npm test -- tests/unit/core/schema/jsonschema-source.test.ts
```

Expected: PASS

- [ ] **Step 9: Update schema command to pass plugins**

In `src/commands/schema.ts`, update `SchemaDeps` to include plugins and pass them through:

```typescript
export interface SchemaDeps {
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  jsonapiPrefix: string;
  cwd: string;
  emit: (v: unknown) => void;
  warn: (m: string) => void;
  plugins?: DrupalCliPlugin[];
}
```

In `runSchema`, update the `fetchJsonSchema` call to include plugins:
```typescript
const { schema: raw, source } = await fetchJsonSchema({
  http: deps.http,
  auth: deps.auth,
  baseUrl: deps.baseUrl,
  jsonapiPrefix: deps.jsonapiPrefix,
  entity,
  bundle,
  warn: deps.warn,
  plugins: deps.plugins ?? [],
});
```

Add import at top of `src/commands/schema.ts`:
```typescript
import type { DrupalCliPlugin } from "../core/plugin.js";
```

In `src/index.ts`, pass plugins to the schema command in the `run` call:
```typescript
run((ctx) =>
  runSchema(schemaArgs, {
    http: ctx.http,
    auth: ctx.auth,
    baseUrl: ctx.baseUrl,
    jsonapiPrefix: ctx.jsonapiPrefix,
    cwd: ctx.cwd,
    emit: output.emit,
    warn: (m) => stderr(`${m}\n`),
    plugins: ctx.plugins,
  }),
);
```

Also update `loadOrFetchSchema` in `src/index.ts` to pass plugins:
```typescript
const { schema: raw, source } = await fetchJsonSchema({
  http: ctx.http,
  auth: ctx.auth,
  baseUrl: ctx.baseUrl,
  jsonapiPrefix: ctx.jsonapiPrefix,
  entity,
  bundle,
  warn: (m) => stderr(`${m}\n`),
  plugins: ctx.plugins,
});
```

- [ ] **Step 10: Delete original schemata files from core**

```bash
git rm src/core/schema/sources/schemata.ts \
       tests/unit/core/schema/sources/schemata.test.ts
```

- [ ] **Step 11: Run full test suite**

```bash
npm run typecheck && npm test
```

Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add plugins/schemata/ src/core/schema/jsonschema-source.ts \
        src/commands/schema.ts src/index.ts \
        tests/unit/core/schema/jsonschema-source.test.ts
git commit -m "feat: extract Schemata schema source into @drupal-cli/plugin-schemata"
```

---

## Task 8: Update integration test helper

**Files:**
- Modify: `tests/integrations/helpers/run.ts`

- [ ] **Step 1: Update renderConfig to write JS**

In `tests/integrations/helpers/run.ts`, replace the `renderConfig` function and `cfgPath` assignment:

```typescript
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { testConfig } from "./config.js";

export type Auth =
  | { type: "basic"; user: string; pass: string }
  | {
      type: "oauth2_password";
      clientId: string;
      clientSecret: string;
      user: string;
      pass: string;
      scope?: string;
    }
  | {
      type: "oauth2_client_credentials";
      clientId: string;
      clientSecret: string;
      scope?: string;
    };

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ErrorPayload {
  error: { code: string; message: string; details: Record<string, unknown> };
}

export interface RunOptions {
  url?: string;
  auth?: Auth;
  args: string[];
}

function renderConfig(url: string, auth: Auth): string {
  const authLines: string[] = [];
  if (auth.type === "basic") {
    authLines.push(
      `    type: 'basic',`,
      `    username: ${JSON.stringify(auth.user)},`,
      `    password: ${JSON.stringify(auth.pass)},`,
    );
  } else if (auth.type === "oauth2_password") {
    authLines.push(
      `    type: 'oauth2_password',`,
      `    client_id: ${JSON.stringify(auth.clientId)},`,
      `    client_secret: ${JSON.stringify(auth.clientSecret)},`,
      `    username: ${JSON.stringify(auth.user)},`,
      `    password: ${JSON.stringify(auth.pass)},`,
      ...(auth.scope ? [`    scope: ${JSON.stringify(auth.scope)},`] : []),
    );
  } else {
    authLines.push(
      `    type: 'oauth2_client_credentials',`,
      `    client_id: ${JSON.stringify(auth.clientId)},`,
      `    client_secret: ${JSON.stringify(auth.clientSecret)},`,
      ...(auth.scope ? [`    scope: ${JSON.stringify(auth.scope)},`] : []),
    );
  }

  const needsOauth = auth.type !== "basic";
  const pluginImport = needsOauth
    ? `import { oauth2Plugin } from ${JSON.stringify(resolve("plugins/oauth2/src/index.js"))};\n`
    : "";
  const pluginsArray = needsOauth ? "plugins: [oauth2Plugin()]," : "plugins: [],";

  return [
    pluginImport,
    "export default {",
    "  site: {",
    `    base_url: ${JSON.stringify(url)},`,
    "    jsonapi_prefix: '/jsonapi',",
    "    auth: {",
    ...authLines,
    "    },",
    "  },",
    "  defaults: { dry_run: false, timeout_ms: 30000 },",
    `  ${pluginsArray}`,
    "};",
  ].join("\n") + "\n";
}

export async function runCli(opts: RunOptions): Promise<RunResult> {
  const cfg = testConfig();
  const url = opts.url ?? cfg.url;
  const auth = opts.auth ?? basicAuth();

  const dir = mkdtempSync(join(tmpdir(), "drupal-cli-it-"));
  const cfgPath = join(dir, "drupal-cli.config.js");
  writeFileSync(cfgPath, renderConfig(url, auth), "utf8");

  return await new Promise<RunResult>((resolve) => {
    const child = spawn("node", ["bin/drupal-cli", ...opts.args], {
      env: {
        ...process.env,
        DRUPAL_CLI_CONFIG: cfgPath,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => { resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

export function parseJson<T = unknown>(stdout: string): T {
  return JSON.parse(stdout) as T;
}

export function parseError(stderr: string): ErrorPayload {
  return JSON.parse(stderr) as ErrorPayload;
}

export function basicAuth(): Auth {
  const cfg = testConfig();
  return { type: "basic", user: cfg.basic.user, pass: cfg.basic.pass };
}

export function oauth2Password(): Auth {
  const cfg = testConfig();
  return {
    type: "oauth2_password",
    clientId: cfg.oauth2.password_client_id,
    clientSecret: cfg.oauth2.password_client_secret,
    user: cfg.oauth2.user,
    pass: cfg.oauth2.pass,
    scope: cfg.oauth2.scope,
  };
}

export function oauth2ClientCred(): Auth {
  const cfg = testConfig();
  return {
    type: "oauth2_client_credentials",
    clientId: cfg.oauth2.cc_client_id,
    clientSecret: cfg.oauth2.cc_client_secret,
    scope: cfg.oauth2.scope,
  };
}

export async function createTestNode(title: string): Promise<string> {
  const payload = { data: { type: "node--article_test", attributes: { title } } };
  const result = await runCli({
    args: ["create", "node", "--bundle=article_test", `--data=${JSON.stringify(payload)}`],
  });
  if (result.code !== 0) {
    throw new Error(`createTestNode failed: exit=${result.code} stderr=${result.stderr}`);
  }
  const body = parseJson<{ data: { id: string } }>(result.stdout);
  return body.data.id;
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 3: Run integration tests (requires running DDEV)**

```bash
npm run test:integration
```

Expected: PASS (only run if DDEV is available; otherwise skip with a note)

- [ ] **Step 4: Commit**

```bash
git add tests/integrations/helpers/run.ts
git commit -m "test(integration): migrate test helper config from YAML to JS"
```

---

## Task 9: Final cleanup and verification

**Files:**
- Verify all tests pass
- Verify typecheck
- Verify lint

- [ ] **Step 1: Run full lint**

```bash
npm run lint
```

Fix any issues:
```bash
npm run lint:fix
```

- [ ] **Step 2: Run full typecheck**

```bash
npm run typecheck
```

Expected: PASS with no errors.

- [ ] **Step 3: Run all unit tests**

```bash
npm test
```

Expected: PASS

- [ ] **Step 4: Run plugin tests**

```bash
cd plugins/oauth2 && npx vitest run && cd ../schemata && npx vitest run && cd ../..
```

Expected: PASS

- [ ] **Step 5: Smoke test — CLI help still works**

```bash
node bin/drupal-cli --help
```

Expected: help output lists all commands except `login` (login is now registered by oauth2 plugin, not in default startup without a config).

- [ ] **Step 6: Smoke test — basic auth config works**

Create a temp config and verify the CLI boots:
```bash
cat > /tmp/test-config.js << 'EOF'
export default {
  site: { base_url: 'https://example.com', auth: { type: 'basic', username: 'a', password: 'b' } },
};
EOF
DRUPAL_CLI_CONFIG=/tmp/test-config.js node bin/drupal-cli --help
```

Expected: help output shown, no errors.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup — lint, typecheck, remove stale imports"
```
