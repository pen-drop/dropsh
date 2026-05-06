# Plugin System & Monorepo Migration — Design Spec

**Date:** 2026-05-04
**Status:** Approved for implementation planning
**Branch:** builder-integration (this spec); canvas plugin will follow in a separate branch

---

## 1. Purpose

Extend drupal-cli with a plugin system that lets builder integrations (Schemata, Canvas, Layout Builder, Display Builder, …) and auth mechanisms ship as independent npm packages. Each plugin hooks into the CLI's discovery, schema, and auth pipelines without modifying core. The config format migrates from YAML to JavaScript (ESM) to support `import`-based plugin registration.

**Core principle:** The CLI core contains only what works with vanilla Drupal core. Everything that requires a contrib module ships as a plugin.

This spec covers:

1. Monorepo migration (pnpm workspaces)
2. Config migration `.drupal-cli.yml` → `drupal-cli.config.js`
3. `DrupalCliPlugin` interface + plugin loader
4. Extraction of OAuth2 auth into `@drupal-cli/plugin-oauth2` (requires `simple_oauth`)
5. Extraction of the Schemata integration into `@drupal-cli/plugin-schemata`

Canvas and future builders (Layout Builder, Display Builder) are out of scope here — each gets its own spec and branch.

---

## 2. Context: Why a Plugin System

The guiding principle is: **core only contains what works with vanilla Drupal core.** Anything that requires a contrib module on the Drupal side ships as a plugin. This applies uniformly to builders, schema sources, and auth mechanisms.

Concretely:
- **Auth:** `basic` works with Drupal core → stays in core. OAuth2 requires `simple_oauth` → `@drupal-cli/plugin-oauth2`.
- **Schema source:** Schemata requires the `schemata` + `jsonapi_schema` modules → `@drupal-cli/plugin-schemata`.
- **Builders:** Canvas, Layout Builder, Display Builder each require their own contrib modules → separate plugins.

Each plugin declares which Drupal-side modules it requires, knows how to interact with those modules' endpoints, and hooks into the relevant CLI pipeline (auth, discovery, schema) without modifying core.

---

## 3. Non-Goals (this spec)

- No Canvas, Layout Builder, or Display Builder plugin — separate specs.
- No plugin versioning or compatibility checks beyond npm peer dependencies.
- No hot-reloading of config or plugins.
- No YAML config migration helper — breaking change is acceptable at `0.0.1-alpha.0`.

---

## 4. Monorepo Structure

**Tooling:** pnpm workspaces. No Nx, no Turborepo — the project has few packages and does not need the orchestration overhead.

The core CLI stays at the repo root — no migration of `src/`, `bin/`, or `tests/`. Only plugins live in subdirectories.

```
drupal-cli/                          ← repo root = core package ("drupal-cli")
  pnpm-workspace.yaml                ← packages: ["plugins/*"]
  package.json                       ← name: "drupal-cli", also workspace root
  biome.json                         ← shared lint/format config
  tsconfig.json                      ← core TS config (also serves as base)
  src/
  bin/
  tests/
  plugins/
    oauth2/                          ← "@drupal-cli/plugin-oauth2"
      package.json
      tsconfig.json                  ← extends ../../tsconfig.json
      src/
      tests/
    schemata/                        ← "@drupal-cli/plugin-schemata"
      package.json
      tsconfig.json                  ← extends ../../tsconfig.json
      src/
      tests/
```

**Package naming convention:** `@drupal-cli/plugin-<name>`

**Cross-package references:** The core does not list any plugin as a `dependency`. Plugins are peer-resolved at runtime via the user's `node_modules`. The config file imports the plugin; the CLI receives the already-instantiated plugin object.

**CI:** The existing GitLab pipeline runs `lint`, `typecheck`, and `test` at repo root. Plugin packages add their own test runs; the root pipeline script iterates over `plugins/*` via pnpm `--recursive`.

---

## 5. Config Migration

### 5.1 New format

`.drupal-cli.yml` is replaced by `drupal-cli.config.js` (ESM, `export default`).

```js
// drupal-cli.config.js
import { oauth2Plugin } from '@drupal-cli/plugin-oauth2';
import { schemataPlugin } from '@drupal-cli/plugin-schemata';

export default {
  site: {
    base_url: process.env.DRUPAL_URL,
    jsonapi_prefix: '/jsonapi',
    auth: {
      type: 'oauth2_password',           // registered by oauth2Plugin
      client_id: process.env.DRUPAL_CLIENT_ID,
      client_secret: process.env.DRUPAL_CLIENT_SECRET,
      username: process.env.DRUPAL_USER,
      password: process.env.DRUPAL_PASSWORD,
    },
  },
  defaults: {
    dry_run: false,
    timeout_ms: 30000,
  },
  plugins: [
    oauth2Plugin(),
    schemataPlugin(),
  ],
};
```

A project using only Basic auth and no Schemata needs no plugins at all:

```js
export default {
  site: {
    base_url: process.env.DRUPAL_URL,
    auth: { type: 'basic', username: process.env.DRUPAL_USER, password: process.env.DRUPAL_PASSWORD },
  },
};
```

`${ENV}` substitution is dropped — `process.env` is used directly in JS. The existing `expandEnv` logic in `config.ts` is removed.

### 5.2 Config loader changes

`src/core/config.ts` replaces `readFile` + `yaml.load` with a dynamic `import()`:

```typescript
const mod = await import(pathToFileURL(configPath).href);
const raw = mod.default;
```

The `loadConfig` signature and the `Config` / `SiteConfig` / `AuthConfig` types stay identical — only the parsing step changes. `plugins` is added as an optional field:

```typescript
export interface Config {
  site: SiteConfig;
  defaults: { dry_run: boolean; timeout_ms: number };
  plugins?: DrupalCliPlugin[];
}
```

### 5.3 Breaking change

`.drupal-cli.yml` support is removed. The example file `.drupal-cli.yml.example` becomes `drupal-cli.config.example.js`. The `js-yaml` dependency is removed from `packages/cli/package.json`.

---

## 6. Plugin Interface

Defined in `packages/cli/src/core/plugin.ts`, exported as part of the public API:

```typescript
import type { Command } from 'commander';
import type { HttpClient } from './http.js';
import type { DiscoveryResult } from './discovery.js';
import type { JsonSchema } from './schema/types.js';

export interface DrupalCliPlugin {
  /** Unique identifier used in log output and error messages. */
  readonly id: string;

  /**
   * Drupal module machine names this plugin requires.
   * The CLI warns (but does not abort) if a required module is not listed
   * in the live discovery output.
   */
  readonly requiredModules: string[];

  /**
   * Fetches a global catalog of builder components/templates from Drupal.
   * Called once per `discover` run; result is passed to extendDiscovery.
   * Builder plugins (Canvas, Layout Builder) use this to load their component
   * registries. Schema-source plugins (Schemata) return an empty object here.
   * Return type is `unknown` — each plugin owns its own catalog shape.
   */
  fetchCatalog(http: HttpClient): Promise<unknown>;

  /**
   * Merges catalog data into the standard discovery result.
   * Must return a new object, not mutate `base`.
   */
  extendDiscovery(base: DiscoveryResult, catalog: unknown): DiscoveryResult;

  /**
   * Extends the JSON Schema for a specific entity type + bundle.
   * Called from the `schema` command after the base schema is generated.
   * Receives `http` so schema-source plugins (e.g. Schemata) can make
   * on-demand per-entity/bundle HTTP calls here instead of in fetchCatalog.
   * Return `baseSchema` unchanged if this plugin does not affect this bundle.
   */
  extendSchema(
    entityType: string,
    bundle: string,
    baseSchema: JsonSchema,
    http: HttpClient,
  ): Promise<JsonSchema>;

  /**
   * Optional. Register auth adapter factories for contrib-module auth types.
   * Called during config loading, before the first HTTP call.
   * Keys are the `auth.type` strings this plugin handles.
   * Core provides only `basic`; OAuth2 types are registered here by plugin-oauth2.
   */
  registerAuthAdapters?(): Record<string, (config: AuthConfig) => AuthAdapter>;

  /**
   * Optional. Register additional CLI commands.
   * Called once at CLI startup, before any command runs.
   */
  registerCommands?(program: Command): void;
}
```

### 6.1 Plugin lifecycle

```
CLI start
  → loadConfig()                reads drupal-cli.config.js, extracts plugins[]
  → registerAuthAdapters?()     each plugin registers its auth factories
                                (must run before any HTTP call)
  → auth factory resolves auth.type against registered adapters
    (error if type not found in core or any plugin)
  → registerCommands?()         each plugin registers optional CLI commands

  → user runs `discover`
      → for each plugin: fetchCatalog(http) → extendDiscovery(base, catalog)
      → cache enriched DiscoveryResult

  → user runs `schema <type>/<bundle>`
      → generate base schema (heuristic source in core)
      → for each plugin: await extendSchema(entityType, bundle, schema, http)
        (schemata plugin makes its per-entity HTTP call here; others are no-ops)
      → return final schema
```

### 6.2 Required-module warning

During `discover`, if `plugin.requiredModules` contains a module not present in `discoveryResult.installed_modules`, the CLI emits a structured warning to stderr:

```json
{ "warning": "plugin 'schemata' requires module 'schemata' which is not installed" }
```

The command still succeeds — the plugin's `extendDiscovery` result is included (it may return graceful partial data).

---

## 7. Schemata Plugin

### 7.1 Extraction

The existing `src/core/schema/sources/schemata.ts` and related types move to `plugins/schemata/src/`. The heuristic source (`src/core/schema/sources/heuristic.ts`) stays in core — it is the fallback when no schemata plugin is configured.

### 7.2 Implementation

```typescript
// plugins/schemata/src/index.ts
export function schemataPlugin(): DrupalCliPlugin {
  return {
    id: 'schemata',
    requiredModules: ['schemata', 'jsonapi_schema'],

    async fetchCatalog(http) {
      // GET /jsonapi/schemata/<entity_type>/<bundle>
      // Returns raw schemata JSON Schema document
    },

    extendDiscovery(base, _catalog) {
      // Schemata does not add to the discovery features block
      return base;
    },

    async extendSchema(entityType, bundle, baseSchema, http) {
      // Makes a per-entity/bundle GET /schemata/<entity>/<bundle>?_format=schema_json
      // Same logic as current src/core/schema/sources/schemata.ts
      // Returns baseSchema unchanged if the endpoint returns 404 (SCHEMATA_MISS)
    },
  };
}
```

### 7.3 Fallback behaviour

Without the schemata plugin in `config.plugins`, the CLI falls back to the heuristic schema source (current default). Behaviour is unchanged for users who do not configure the plugin.

---

## 8. OAuth2 Plugin

### 8.1 Extraction

The three OAuth2 adapters (`oauth2_password`, `oauth2_client_credentials`, `oauth2_authcode`) move from `packages/cli/src/core/auth/` to `plugins/oauth2/src/`. Core retains only `basic.ts` and the `AuthAdapter` interface + `AuthConfig` type.

The auth factory in core no longer has a built-in registry of OAuth2 types. It resolves `auth.type` against adapters registered by plugins. If the type is unknown, it throws a `ConfigError` pointing to the missing plugin.

### 8.2 Implementation

```typescript
// plugins/oauth2/src/index.ts
export function oauth2Plugin(): DrupalCliPlugin {
  return {
    id: 'oauth2',
    requiredModules: ['simple_oauth'],

    registerAuthAdapters() {
      return {
        oauth2_password:             (config) => new OAuth2PasswordAdapter(config),
        oauth2_client_credentials:   (config) => new OAuth2ClientCredentialsAdapter(config),
        oauth2_authcode:             (config) => new OAuth2AuthCodeAdapter(config),
      };
    },

    async fetchCatalog(_http) { return {}; },
    extendDiscovery(base, _catalog) { return base; },
    async extendSchema(_entityType, _bundle, baseSchema, _http) { return baseSchema; },
  };
}
```

### 8.3 Auth adapter interface (unchanged)

`AuthAdapter` and `AuthConfig` stay in `packages/cli/src/core/auth/types.ts` and are exported as public API so plugins can implement them.

---

### 9.1 Unit tests

- `plugin-loader.test.ts` — config with zero plugins, one plugin, two plugins; unknown auth type error; warning when required module missing
- `config.test.ts` — dynamic import of JS config, `plugins` field parsed correctly, YAML rejected
- `plugin-oauth2/` — unit tests for each adapter (correct request shape, token caching)
- `plugin-schemata/` — unit tests mirror existing `schemata.test.ts`; no Drupal instance needed

### 9.2 Integration tests

Existing integration tests in `packages/cli/tests/integrations/` continue to run against DDEV. Auth and schemata integration tests move to their respective plugin packages (same DDEV fixture).

---

## 10. Migration Path (for existing users)

1. Replace `.drupal-cli.yml` with `drupal-cli.config.js` using `process.env` references.
2. Run `pnpm install` at repo root.
3. If using OAuth2 auth: `pnpm add @drupal-cli/plugin-oauth2` and add `oauth2Plugin()` to `config.plugins`.
4. If using Schemata-based schema generation: `pnpm add @drupal-cli/plugin-schemata` and add `schemataPlugin()` to `config.plugins`.
5. Projects using only Basic auth and heuristic schema need no plugins at all.

---

## 11. Out of scope / future

- Canvas plugin — separate spec + branch (`plugin-canvas`)
- Layout Builder plugin — requires `jsonapi_layout_builder` on Drupal side; separate spec
- Display Builder plugin — separate spec once the module's API stabilises
- Plugin versioning / compatibility matrix
- Project-local plugin overrides
