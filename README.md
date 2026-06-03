# dropsh

Entity-agnostic helper CLI for Drupal 11 JSON:API. Written in TypeScript, used directly by the `dropsh` Claude skill for editorial publishing workflows.

This is the foundation CLI. Discovery, schema generation, and the skill layer are delivered by follow-up plans.

## Install

This is a [pnpm](https://pnpm.io) workspace (root CLI + `plugins/*` + `packages/*`).
The pinned pnpm version is declared in `package.json` (`packageManager`); enable it with
`corepack enable`.

```bash
pnpm install
pnpm run build
```

## Configure

Copy `dropsh.config.example.js` to `dropsh.config.js` in your project. The config
carries only **non-secret connection parameters** — secrets (passwords, client
secrets, tokens) are never stored in the config. They are prompted at login and
persisted separately (see [Authentication](#authentication)).

```js
import { basicAuthPlugin } from "dropsh";
import { oauth2Plugin } from "@dropsh/plugin-oauth2";

export default {
  site: { base_url: "https://my-drupal.example.com", jsonapi_prefix: "/jsonapi" },
  defaults: { dry_run: false, timeout_ms: 30000 },
  plugins: [
    basicAuthPlugin(),
    oauth2Plugin({ type: "oauth2_authcode", client_id: "my-client", token_url: "https://my-drupal.example.com/oauth/token" }),
  ],
};
```

## Authentication

Authentication is provider-based. Each entry in `plugins` that contributes an auth
provider (`basicAuthPlugin()`, `oauth2Plugin(...)`) becomes a login option. You log
in once per host; dropsh stores a single active session and uses it for every
subsequent command.

```bash
dropsh auth login                  # interactive picker over the configured providers
dropsh auth login --provider basic # skip the picker and use a provider by id
dropsh auth logout                 # clear the active session for the host
dropsh auth status                 # show the active session
dropsh auth status --json          # machine-readable status
```

`dropsh auth login` prompts for any secrets the chosen provider needs (basic auth
prompts username + password; OAuth2 password / client-credentials prompt the client
secret and, for the password grant, the user password; `oauth2_authcode` opens the
browser for a PKCE flow). On a non-interactive (non-TTY) shell you must pass
`--provider <id>`.

### Where secrets live

Secrets and tokens are **never** written to `dropsh.config.js`. The active session
is stored per host at `~/.config/dropsh/<host>.json` with file mode `0600`:

```json
{ "activeProvider": "oauth2_authcode", "session": { "access_token": "…", "expires_at": 1717459200000 } }
```

Only non-secret connection parameters stay in the config:

- **basic** — `basicAuthPlugin()` (no fields; an optional `username` may be
  pre-seeded, but the password is always prompted)
- **oauth2** — `client_id`, `token_url`, optional `scope`; `redirect_port` for
  `oauth2_authcode`; `username` for `oauth2_password`. The `client_secret` and the
  user `password` are prompted at login, never stored in config.

## Commands

All commands write JSON to stdout, structured errors to stderr, and use exit codes 0-5.

```bash
dropsh read <entity_type>/<bundle>/<uuid>
dropsh search <entity_type> [--bundle=<b>] [--filter=key:value]… [--limit=N]
dropsh create <entity_type> --bundle=<b> --data=<json|@file> [--dry-run] [--no-validate]
dropsh update <entity_type>/<bundle>/<uuid> --data=<json|@file> [--dry-run] [--no-validate]
dropsh delete <entity_type>/<bundle>/<uuid> [--dry-run]
dropsh upload-file --target=<entity_type>/<bundle>/<uuid>/<field> --file=<path> [--dry-run]
dropsh schema [--refresh]
dropsh schema <entity_type>/<bundle> [--for=create|update] [--refresh]
```

### `schema`

Without a target, prints the list of available `<entity_type>/<bundle>` targets on the site.

With a target (e.g. `node/article`), prints a JSON Schema document that validates a JSON:API request body for that resource.

- `--for=create` (default) / `--for=update` — operation variant (update clears required fields)
- `--refresh` — bypass the cache for this call

If the site has `drupal/schemata` + `drupal/schemata_json_schema` installed, the schema is authoritative (required fields, constraints). Otherwise, a shallow schema is returned from sample records with a warning on stderr (field names only, no required fields, no constraints). The output carries `x-dropsh-source: "schemata" | "heuristic" | "heuristic-empty"` so consumers can tell how strict the schema is.

Schemas are cached under `.dropsh/cache/`. Override the config path via `DROPSH_CONFIG` or `--config`.

### Canvas schema plugin

Canvas support lives in `@dropsh/plugin-canvas` and requires these Drupal modules:

- `canvas`
- `jsonapi_sdc`

Register the plugin in `dropsh.config.js`:

```js
import { basicAuthPlugin } from "dropsh";
import { canvasPlugin } from "@dropsh/plugin-canvas";

export default {
  site: { base_url: "https://my-drupal.example.com", jsonapi_prefix: "/jsonapi" },
  plugins: [
    basicAuthPlugin(),
    canvasPlugin(),
  ],
};
```

Then ask for the Canvas schema:

```bash
dropsh schema canvas_page/canvas_page --for=create
```

The returned JSON Schema includes `x-dropsh-builder: "canvas"`, `x-dropsh-components`, and a typed `attributes.components` array. If `jsonapi_sdc` is missing or inaccessible, the Canvas schema fails instead of returning incomplete component information.

### Client-side validation in `create` / `update`

`dropsh create` and `dropsh update` run the payload through the bundle's schema before sending it. A validation failure exits with code 4 (`E_VALIDATION`) and emits the Ajv errors on stderr without issuing an HTTP request. Pass `--no-validate` to skip the check.

## Writing plugins

A plugin is a function that returns a `DropSHPlugin`. Plugins can do three
independent things — extend schemas, provide an auth provider, and register CLI
commands — and a single plugin may combine any of them. Everything you need is
re-exported from `dropsh/plugin`:

```ts
import type {
  DropSHPlugin, PluginContext, SchemaOperation, // schema extension
  AuthProvider, AuthContext, AuthSession, AdapterRuntime, AuthAdapter, // auth
} from "dropsh/plugin";
import { AuthError, ConfigError, HttpError, createHttpClient } from "dropsh/plugin";
```

The `DropSHPlugin` shape:

```ts
interface DropSHPlugin {
  readonly id: string;             // unique id, also the auth-provider key
  readonly requiredModules: string[]; // Drupal modules the plugin needs
  authProvider?: AuthProvider;     // optional: contributes a login option
  extendSchema(entityType, bundle, baseSchema, ctx): Promise<unknown>;
  extendOperationSchema?(entityType, bundle, operation, schema, ctx): Promise<unknown>;
  registerCommands?(program): void; // optional: add Commander subcommands
}
```

A plugin is wired up by adding it to `plugins` in `dropsh.config.js`. Package it
as its own npm module with `dropsh` as a **peer dependency** (so it shares the
host's core), or keep it local and import it directly.

### A schema-extension plugin

`extendSchema` is called while building the JSON Schema for a target. It receives
the schema produced so far and returns a (possibly) modified schema. Return
`baseSchema` unchanged when the plugin does not apply. `extendOperationSchema`
runs later, per operation (`create` / `update`), when you need to vary the schema
by operation. `ctx: PluginContext` gives you `{ http, auth, baseUrl }` to call the
site if you need live data.

```ts
import type { DropSHPlugin, PluginContext, SchemaOperation } from "dropsh/plugin";

// Marks node/article's `field_legacy_id` read-only and adds a provenance tag.
export function articleRulesPlugin(): DropSHPlugin {
  return {
    id: "article-rules",
    requiredModules: [],

    async extendSchema(entityType: string, bundle: string, baseSchema: unknown, _ctx: PluginContext) {
      if (entityType !== "node" || bundle !== "article") return baseSchema;
      const schema = baseSchema as {
        properties?: { attributes?: { properties?: Record<string, unknown> } };
      };
      const attrs = schema.properties?.attributes?.properties;
      if (attrs?.field_legacy_id && typeof attrs.field_legacy_id === "object") {
        (attrs.field_legacy_id as Record<string, unknown>).readOnly = true;
      }
      return { ...schema, "x-extended-by": "article-rules" };
    },

    // Optional: on create, require a field that is optional on update.
    async extendOperationSchema(
      entityType: string,
      bundle: string,
      operation: SchemaOperation,
      schema: unknown,
      _ctx: PluginContext,
    ) {
      if (entityType !== "node" || bundle !== "article" || operation !== "create") return schema;
      const s = schema as { required?: string[] };
      const required = new Set(s.required ?? []);
      required.add("field_legacy_id");
      return { ...s, required: [...required] };
    },
  };
}
```

Register it:

```js
import { articleRulesPlugin } from "./plugins/article-rules.js";
export default {
  site: { base_url: "https://my-drupal.example.com", jsonapi_prefix: "/jsonapi" },
  plugins: [basicAuthPlugin(), articleRulesPlugin()],
};
```

The bundled `@dropsh/plugin-schemata` (authoritative schemas from the Drupal
`schemata` module) and `@dropsh/plugin-canvas` (component schemas) are real
examples of schema plugins — see `plugins/schemata/src/index.ts` and
`plugins/canvas/src/index.ts`.

### An auth-provider plugin

An auth provider is a single `AuthProvider` object exposed via the plugin's
`authProvider` field. It owns one protocol end-to-end: `login` acquires a session
(prompting / browser as needed), `createAdapter` turns a stored session into the
`apply(req)` runtime hook, and `logout` / `status` round it out. The core handles
the picker, the single-session state file, and dispatch — the provider never
touches stdin or disk directly; it uses the injected `AuthContext` / `AdapterRuntime`.

```ts
import type {
  AdapterRuntime, AuthAdapter, AuthContext, AuthProvider, AuthSession, DropSHPlugin,
} from "dropsh/plugin";
import { ConfigError } from "dropsh/plugin";

// Static API-key auth: prompts for a token at login, sends it as a header.
export function apiKeyProvider(): AuthProvider {
  return {
    id: "apikey",
    displayName: "API key (X-API-Key header)",
    capabilities: { login: true, logout: true, status: true },

    async login(ctx: AuthContext): Promise<AuthSession> {
      const key = await ctx.prompt({ label: "API key", secret: true });
      if (!key) throw new ConfigError("apikey: a non-empty key is required");
      return { api_key: key };
    },

    async logout(_ctx: AuthContext) {
      // No server-side revoke; the core clears the local session file.
    },

    async status(session: AuthSession | null) {
      return { loggedIn: session !== null, provider: "apikey" };
    },

    createAdapter(session: AuthSession, _rt: AdapterRuntime): AuthAdapter {
      const key = session.api_key;
      if (typeof key !== "string") throw new ConfigError("apikey: corrupt session");
      return {
        async apply(req) {
          return { ...req, headers: { ...(req.headers ?? {}), "X-API-Key": key } };
        },
      };
    },
  };
}

export function apiKeyPlugin(): DropSHPlugin {
  return {
    id: "apikey",
    requiredModules: [],
    authProvider: apiKeyProvider(),
    async extendSchema(_entityType, _bundle, schema) {
      return schema; // not a schema plugin
    },
  };
}
```

Once registered in `plugins`, it shows up automatically in `dropsh auth login`:

```bash
dropsh auth login --provider apikey
```

`AuthContext` (passed to `login`/`logout`) provides `baseUrl`, an `http` client,
`prompt({ label, secret })`, `openBrowser(url)`, `stdout(s)`, and `now()`.
`AdapterRuntime` (passed to `createAdapter`) provides `http`, `now()`, and
`save(session)` — call `save` to persist a refreshed session back to the active
slot (the OAuth2 `oauth2_authcode` provider uses this to store a refreshed token).
Throw `AuthError` for expired/invalid sessions so the CLI exits with code 3 and
tells the user to run `dropsh auth login`. The bundled `@dropsh/plugin-oauth2`
(`plugins/oauth2/src/provider.ts`) and the core basic provider
(`src/core/auth/basic.ts`) are full reference implementations.

## Development

```bash
pnpm test            # Vitest unit suite
pnpm run test:watch
pnpm run typecheck
pnpm run build
```

### Integration tests

Local-only, requires DDEV. See `tests/integrations/README.md`.

```bash
pnpm run drupal:up
pnpm run test:integration
pnpm run drupal:down
```

## Publishing

The CLI and all workspace packages are published together with a single command:

```bash
pnpm run release
```

This publishes `dropsh` (workspace root) plus `@dropsh/sdc-client`,
`@dropsh/plugin-schemata`, `@dropsh/plugin-oauth2` and `@dropsh/plugin-canvas`.
`prepublishOnly` runs typecheck + build per package; scoped packages publish with
public access via their `publishConfig`, and pnpm rewrites `workspace:*` deps to the
released version. Log in first with `npm login`.
