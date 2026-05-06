# Plugin Config & Auth Refactor — Design Spec

**Date:** 2026-05-05
**Status:** Approved
**Branch:** builder-integration

---

## 1. Purpose

Move plugin configuration out of the global config and into each plugin's
own factory function. Auth becomes a plugin like any other — no special
`site.auth` section, no central auth registry. Every plugin is a factory
function that validates its own config at construction time and captures it
in a closure.

---

## 2. Core Principles

- **Explicit over implicit.** No values are derived from other config
  sections. Token URLs, redirect URIs, usernames — all are set directly in
  the plugin config.
- **Validation at the call site.** Each plugin factory throws `ConfigError`
  immediately if required fields are missing or invalid. No late failures.
- **Closure over threading.** Config lives in the factory closure; plugin
  methods do not receive a config parameter. The interface stays minimal.
- **Auth is a plugin.** `site.auth` is removed. Auth capability is provided
  by whichever plugin implements the optional `createAuthAdapter()` method.

---

## 3. Plugin Interface

`src/core/plugin.ts`:

```ts
export interface DrupalCliPlugin {
  readonly id: string;
  readonly requiredModules: string[];

  /** Optional. First plugin with this method provides the auth adapter. */
  createAuthAdapter?(): AuthAdapter;

  extendSchema(
    entityType: string,
    bundle: string,
    baseSchema: unknown,
    ctx: PluginContext,
  ): Promise<unknown>;
  registerCommands?(program: Command): void;
}
```

**Removed from interface:** `registerAuthAdapters()`, `fetchCatalog()`, `extendDiscovery()`.

`fetchCatalog` and `extendDiscovery` are removed — both were no-ops in all
existing plugins and introduced an untyped intermediate value (`catalog:
unknown`). Builder plugins that need discovery extension will be designed
from scratch when the first concrete use case arises.

**Removed from core:** `AuthConfig`, `AuthRegistry`, `AuthAdapterFactory`,
`createAuthRegistry()`, `createAuthAdapter()`.

---

## 4. Config Format

`src/core/config.ts`:

```ts
export interface Config {
  site: { base_url: string; jsonapi_prefix: string };
  defaults: { dry_run: boolean; timeout_ms: number };
  plugins: DrupalCliPlugin[];
}
```

`site.auth` is removed entirely. `AuthConfig` is removed from `Config` and
from `SiteConfig`.

Example `drupal-cli.config.js`:

```js
import { basicAuthPlugin } from "drupal-cli/plugin";
import { oauth2Plugin } from "@drupal-cli/plugin-oauth2";
import { schemataPlugin } from "@drupal-cli/plugin-schemata";

export default {
  site: {
    base_url: "http://mysite.ddev.site",
    jsonapi_prefix: "/jsonapi",
  },
  plugins: [
    oauth2Plugin({
      type: "oauth2_authcode",
      client_id: "my-client",
      token_url: "http://mysite.ddev.site/oauth/token",
      scope: "integration:content",
      redirect_port: 7432,
    }),
    schemataPlugin(),
  ],
};
```

Basic auth example:

```js
import { basicAuthPlugin } from "drupal-cli/plugin";

export default {
  site: { base_url: "http://mysite.ddev.site", jsonapi_prefix: "/jsonapi" },
  plugins: [
    basicAuthPlugin({ username: "admin", password: "admin" }),
  ],
};
```

---

## 5. Core Auth Wiring

`src/index.ts` replaces the registry lookup with a linear plugin scan:

```ts
const authPlugin = cfg.plugins.find(p => p.createAuthAdapter);
if (!authPlugin) {
  throw new ConfigError(
    "No auth plugin configured. Add basicAuthPlugin() or oauth2Plugin() to config.plugins."
  );
}
const auth = authPlugin.createAuthAdapter!();
```

No registry, no type dispatch, no `AuthConfig` plumbing.

---

## 6. basicAuthPlugin (Core)

Stays in `src/core/auth/basic.ts`, exported via `drupal-cli/plugin`:

```ts
export interface BasicAuthConfig {
  username: string;
  password: string;
}

export function basicAuthPlugin(config: BasicAuthConfig): DrupalCliPlugin {
  if (!config.username) throw new ConfigError("basicAuthPlugin: username required");
  if (!config.password) throw new ConfigError("basicAuthPlugin: password required");
  const adapter = createBasicAuth(config);
  return {
    id: "basic",
    requiredModules: [],
    createAuthAdapter: () => adapter,
    extendSchema: async (_e, _b, schema) => schema,
  };
}
```

---

## 7. oauth2Plugin (@drupal-cli/plugin-oauth2)

```ts
export interface OAuth2Config {
  type: "oauth2_password" | "oauth2_client_credentials" | "oauth2_authcode";
  client_id: string;
  token_url: string;       // always required, always explicit
  client_secret?: string;  // required for password + client_credentials
  username?: string;       // required for password grant
  password?: string;       // required for password grant
  scope?: string;
  redirect_port?: number;  // authcode only, default 7432
}

export function oauth2Plugin(config: OAuth2Config): DrupalCliPlugin {
  const cfg = validateOAuth2Config(config); // throws ConfigError on invalid
  return {
    id: "oauth2",
    requiredModules: ["simple_oauth"],
    createAuthAdapter: () => createOAuth2Auth(cfg),
    registerCommands: (program) => { /* login command */ },
    extendSchema: async (_e, _b, schema) => schema,
  };
}
```

`validateOAuth2Config` checks required fields per `type` and throws
`ConfigError` with a clear message on the first failure.

---

## 8. schemataPlugin (@drupal-cli/plugin-schemata)

No auth involvement. Factory takes no config (or an empty object for
consistency). Signature stays `schemataPlugin()`.

---

## 9. Playground Config

```js
import { oauth2Plugin } from "@drupal-cli/plugin-oauth2";
import { schemataPlugin } from "@drupal-cli/plugin-schemata";

export default {
  site: {
    base_url: "http://drupal-cli-test-schemata-5fdcffda.ddev.site",
    jsonapi_prefix: "/jsonapi",
  },
  plugins: [
    oauth2Plugin({
      type: "oauth2_authcode",
      client_id: "tests-authcode",
      token_url: "http://drupal-cli-test-schemata-5fdcffda.ddev.site/oauth/token",
      scope: "integration:content",
      redirect_port: 7432,
    }),
    schemataPlugin(),
  ],
};
```

Plugin imports use package names (`@drupal-cli/plugin-*`), not relative
dist paths.

---

## 10. Playground Package Dependencies

`playground/package.json` adds the two plugin packages as workspace
dependencies:

```json
{
  "dependencies": {
    "drupal-cli": "file:..",
    "@drupal-cli/plugin-oauth2": "file:../plugins/oauth2",
    "@drupal-cli/plugin-schemata": "file:../plugins/schemata"
  }
}
```

---

## 11. Removed Exports from drupal-cli/plugin

- `AuthConfig`
- `AuthAdapterFactory`
- `AuthFactoryDeps`

These types are no longer part of the public plugin API.

---

## 12. Migration Impact

| Was | Wird |
|-----|------|
| `site.auth: { type, ... }` | Plugin-Konstruktor-Parameter |
| `registerAuthAdapters()` | `createAuthAdapter?()` Closure |
| `AuthConfig` | Plugin-spezifisches Interface (z.B. `OAuth2Config`) |
| Relative Dist-Imports im Playground | Package-Name-Imports |
| `createAuthRegistry` / `createAuthAdapter` in Core | Entfernt |
| `fetchCatalog()` / `extendDiscovery()` | Entfernt (YAGNI) |

---

## 13. Testing

- Unit-Tests für `basicAuthPlugin` und `oauth2Plugin`: Validation-Fehler bei fehlenden Feldern, korrekte Adapter-Erstellung.
- Bestehende Integrationstests bleiben — Config-Fixtures werden auf neues Format umgestellt.
- `validateOAuth2Config` bekommt eigene Unit-Tests pro `type`.
