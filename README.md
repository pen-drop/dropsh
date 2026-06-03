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
