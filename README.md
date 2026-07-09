# dropsh

dropsh is a CLI for Drupal JSON:API with JSON Schema output and request
validation. It is meant to give agents enough structure to build reliable Drupal
payloads instead of guessing field names, required properties, component shapes,
or authentication details.

The CLI can read and search existing content, print schemas for create and update
payloads, validate data locally, and then send the JSON:API request. Plugins can
extend those schemas with site-specific fields, component metadata, builder
constraints, and other context the agent needs to do the job. Authentication for
common Drupal setups is handled through plugins as well.

## Concept

dropsh is built for workflows where an agent or script needs to work with Drupal
content without hard-coding every content model.

- `dropsh schema` returns JSON Schema for targets like `node/article`.
- `create` and `update` validate payloads before sending them to Drupal.
- Agents can inspect existing records with `search` and `read` before generating
  new data.
- Plugins can replace shallow inferred schemas with authoritative Drupal schemas
  and enrich payload schemas with the extra context an agent needs.
- Auth plugins support common Drupal authentication systems without changing the
  commands that use them.
- A skill can use dropsh as its Drupal execution layer and focus on the workflow.

## Install

Install dropsh globally to put the `dropsh` binary on `PATH`. No local project,
`package.json`, or `node_modules` is required — dropsh runs from anywhere:

```bash
npm i -g dropsh          # or: pnpm add -g dropsh
dropsh --help            # binary now on PATH, no project needed
```

dropsh needs Node.js 20 or newer.

Plugins are **separate published packages** and are **not** bundled in the
`dropsh` tarball. To use one, install it next to dropsh — either globally
(`npm i -g dropsh @dropsh/plugin-oauth2`) or for a single command via
`npx -p dropsh -p @dropsh/plugin-oauth2 dropsh …`. See [Plugins](#plugins) for
how names resolve.

<details>
<summary>From source (contributors)</summary>

This repository is a pnpm workspace containing the root CLI, packages, and
plugins. Build it from source when developing dropsh itself:

```bash
corepack enable
pnpm install
pnpm run build
```

The required Node.js and pinned pnpm versions are declared in `package.json`.
Inside the workspace, plugins resolve from the local `node_modules`, so config
may import the plugin factories directly (see the workspace variant under
[Configuration](#configuration)).

</details>

## Drupal Prerequisites

The base CLI expects a Drupal site with JSON:API enabled and reachable from the
machine running dropsh.

Minimum Drupal setup:

- Drupal 10 or 11
- JSON:API enabled
- A user or OAuth client with permissions for the entities you want to access

Optional modules unlock stricter schemas or builder-specific support:

| Feature | Drupal modules |
| --- | --- |
| OAuth2 login | `simple_oauth` |
| Authoritative schemas (Drupal 10.1+/11) | `jsonapi_schema` |
| Authoritative schemas (legacy; 500s on D11/PHP 8.4) | `schemata`, `schemata_json_schema` |
| Canvas schemas | `canvas`, `jsonapi_sdc` |
| Display Builder schemas | `display_builder`, `display_builder_entity_view`, `jsonapi_sdc` |

dropsh works without an authoritative-schema module. In that case, `dropsh
schema` falls back to a shallow schema inferred from JSON:API sample records.
Installing `jsonapi_schema` lets `@dropsh/plugin-jsonapi-schema` return a more
precise schema with Drupal's required fields, formats, and constraints — so
`create`/`update` reject malformed payloads client-side. On **Drupal 11 / PHP
8.4** prefer `jsonapi_schema`: the older `schemata_json_schema` endpoint returns
HTTP 500 there.

### Installing the Drupal modules

JSON:API ships with Drupal core; enable it together with the optional modules
you need:

```bash
# Minimum: JSON:API (Drupal core)
drush en jsonapi

# Optional: OAuth2 login
composer require drupal/simple_oauth
drush en simple_oauth

# Optional: authoritative schemas (Drupal 10.1+/11, PHP 8.4) — recommended
composer require drupal/jsonapi_schema
drush en jsonapi_schema

# Legacy alternative — the schemata endpoint returns HTTP 500 on
# Drupal 11 / PHP 8.4; prefer jsonapi_schema there.
# composer require drupal/schemata
# drush en schemata schemata_json_schema
# drush role:perm:add "content_editor" "access schemata data models"
```

`jsonapi_schema` serves its routes under the JSON:API prefix (`/jsonapi/*`), so
the role/consumer used by dropsh needs no extra permission beyond JSON:API
access. (The legacy `schemata` endpoint instead needs `access schemata data
models` on that role.)

By default JSON:API only accepts read operations. To create, update, or delete
entities through dropsh, set **Accept all JSON:API create, read, update, and
delete operations** at `/admin/config/services/jsonapi` (or via
`drush config:set jsonapi.settings read_only 0`).

## Configuration

Create a `dropsh.config.js` in the directory where you run dropsh. The config
holds only non-secret connection settings. Passwords, client secrets, and tokens
are prompted during login and stored outside the project in the per-host session
store.

Register plugins as **descriptor objects** — `{ plugin, with?, export? }` — that
name a package by string. dropsh resolves and constructs each plugin itself, so
the config needs **no `import` statements** and **no local `node_modules`**. This
is the path a global install uses:

```js
export default {
  site: {
    base_url: "https://my-drupal.example.com",
    jsonapi_prefix: "/jsonapi",
  },
  defaults: {
    dry_run: false,
    timeout_ms: 30000,
  },
  plugins: [
    { plugin: "dropsh/plugin", export: "basicAuthPlugin" },
    {
      plugin: "@dropsh/plugin-oauth2",
      export: "oauth2Plugin",
      with: {
        type: "oauth2_authcode",
        client_id: "my-client",
        token_url: "https://my-drupal.example.com/oauth/token",
      },
    },
    { plugin: "@dropsh/plugin-jsonapi-schema", export: "jsonapiSchemaPlugin" },
  ],
};
```

Each descriptor's `with` is passed to the plugin factory (legacy alias:
`options`). `export` names the factory to call and is **required** for every
`@dropsh/plugin-*` package — they export named factories with no default export
(see [Plugins](#plugins)). Basic auth lives on the `dropsh/plugin` entry, so its
descriptor names `dropsh/plugin` with `export: "basicAuthPlugin"`.

Use `dropsh.config.example.js` as a fuller starting point. Override the config
path with `--config <path>` or `DROPSH_CONFIG`.

<details>
<summary>Workspace variant — importing factories directly</summary>

Inside the pnpm workspace or any project that has the plugin packages in its
local `node_modules`, you may skip descriptors and import the factories instead.
The `plugins[]` array then holds constructed plugins:

```js
import { basicAuthPlugin } from "dropsh/plugin";
import { oauth2Plugin } from "@dropsh/plugin-oauth2";
import { jsonapiSchemaPlugin } from "@dropsh/plugin-jsonapi-schema";

export default {
  site: { base_url: "https://my-drupal.example.com", jsonapi_prefix: "/jsonapi" },
  plugins: [
    basicAuthPlugin(),
    oauth2Plugin({
      type: "oauth2_authcode",
      client_id: "my-client",
      token_url: "https://my-drupal.example.com/oauth/token",
    }),
    jsonapiSchemaPlugin(),
  ],
};
```

The two forms may be mixed in one `plugins[]` array. `import` resolves relative
to the config file, so it only works when the packages are installed there.

</details>

## Authentication

Authentication is configured through plugins. Each plugin that contributes an
auth provider appears as a login option.

```bash
dropsh auth login
dropsh auth login --provider basic
dropsh auth status
dropsh auth logout
```

Secrets and tokens are never written to `dropsh.config.js`. Sessions are stored
per host under `~/.config/dropsh/<host>.json` with file mode `0600`.

### Named profiles — many identities per host

A host can hold several **named auth profiles** at once (e.g. two OAuth2 scopes)
and you switch between them without logging in again. Each auth provider is one
profile, identified by its `id`. For OAuth2, give each `oauth2Plugin` an explicit
`id` (it defaults to the grant `type` when omitted) so two profiles of the same
grant flow can coexist:

```js
plugins: [
  oauth2Plugin({
    id: "session",
    default: true,                       // used when none is selected/active
    type: "oauth2_client_credentials",
    client_id: "my-client",
    client_secret,                       // enables headless auto-renew (see below)
    token_url: "https://my-drupal.example.com/oauth/token",
    scope: "some:scope",
  }),
  oauth2Plugin({
    id: "pm",
    type: "oauth2_client_credentials",
    client_id: "my-client",
    client_secret,
    token_url: "https://my-drupal.example.com/oauth/token",
    scope: "other:scope",
  }),
],
```

```bash
dropsh auth login --provider session     # log in and store the "session" profile
dropsh auth login --provider pm          # log in and store the "pm" profile too
dropsh auth status                       # list all profiles; * marks the active one
dropsh auth use pm                       # switch the persistent active profile
dropsh --auth-profile session read …     # override the profile for one command
dropsh auth logout --profile pm          # drop one profile
dropsh auth logout --all                 # drop every profile for this host
```

Profile selection precedence (highest first):

1. `--auth-profile <id>` (global flag)
2. `$DROPSH_AUTH_PROFILE`
3. the stored active profile (`auth use`)
4. the provider marked `default: true`
5. the sole configured profile, if there is only one

With more than one profile and none active/default/selected, dropsh asks you to
run `auth use <id>` or pass `--auth-profile <id>`.

The on-disk format holds every profile in one file; legacy single-session files
are upgraded automatically on first write.

### Token renewal

dropsh renews expiring tokens automatically — both **proactively** (before a token
lapses) and **reactively** (if the server rejects a token with `401`, dropsh renews
once and retries the request). Renewal uses the credentials already available:

- **`oauth2_authcode`** — the stored `refresh_token`.
- **`oauth2_client_credentials`** — re-mints from `client_secret`, so keep the
  secret in config (e.g. `conductor.config.local.js`) for unattended runs. Without
  it, an interactive login cannot be renewed and you must `auth login` again.

Renewal is isolated per profile: refreshing one profile never touches another's
session or the active pointer.

## Commands

All commands write JSON to stdout, structured errors to stderr, and use stable
exit codes.

```bash
dropsh read <entity_type>/<bundle>/<uuid> [--include=<field>,…]
dropsh search <entity_type> [--bundle=<b>] [--filter=key:value]… [--limit=N] [--include=<field>,…]
dropsh create <entity_type> --bundle=<b> --data=<json|@file> [--dry-run] [--no-validate]
dropsh update <entity_type>/<bundle>/<uuid> --data=<json|@file> [--dry-run] [--no-validate]
dropsh delete <entity_type>/<bundle>/<uuid> [--dry-run]
dropsh upload-file --target=<entity_type>/<bundle>/<uuid>/<field> --file=<path> [--dry-run]
dropsh schema [--refresh]
dropsh schema <entity_type>/<bundle> [--for=create|update] [--refresh]
```

`create` and `update` validate payloads against the current schema by default.
Pass `--no-validate` when you intentionally want to skip local validation.

### `--include` on `read` / `search`

Pass `--include` to embed related resources in the response's JSON:API
`included` array (the standard `?include=` query parameter). Accepts a
comma-separated list or repeated/space-separated values, and nested paths with
dots:

```bash
dropsh read node/article/<uuid> --include field_related,field_image
dropsh search node --bundle=article --include field_related --filter status:1
dropsh read node/article/<uuid> --include field_related.uid
```

`read` and `search` are the only commands that accept `--include`. Without it,
the response contains only the primary resource(s).

### Output formats

By default every command emits JSON. Load a renderer plugin and pass a global
`--format <id>` (before the subcommand) to render entities differently:

```bash
dropsh --format md read node/article/<uuid>      # Markdown detail view
dropsh --format table search node --bundle=article  # aligned table
```

`--format` applies only to entity commands (`read`, `search`, `create`,
`update`). Using it on `delete`, `upload-file`, or `schema` exits with code 2.

The `@dropsh/plugin-tui` plugin adds an interactive full-screen format,
selected the same way via `--format tui` (requires a TTY — an interactive
terminal):

```bash
dropsh --format tui read node/article/<uuid>          # opens straight into the detail pane
dropsh --format tui search node --bundle=article      # list → Enter → detail pane
```

`read --format tui` boots directly into the detail pane for the single
entity. `search --format tui` shows a navigable list (↑/↓, Enter opens the
detail pane, Esc/q goes back or quits). `--include` flows through to the
detail pane in both cases.

## Plugins

Plugins are regular JavaScript or TypeScript modules that return a `dropshPlugin`.
A plugin can contribute one or more of these capabilities:

- an auth provider
- schema extensions
- operation-specific schema changes for `create` or `update`
- additional CLI commands

Schema plugins are the main way to make dropsh useful for agents on real sites.
dropsh can generate a basic schema without them, but plugins can make that schema
more precise by adding required fields, component definitions, builder-specific
structures, allowed values, and other metadata that helps the agent produce a
valid payload. Auth plugins keep the same command interface while supporting
common Drupal authentication systems such as basic auth or OAuth2.

Plugins developed in this repository (**"bundled"** = part of this repo, **not**
shipped inside the `dropsh` npm tarball — each is a separately published package):

| Package | Factory export | Purpose |
| --- | --- | --- |
| [`@dropsh/plugin-oauth2`](plugins/oauth2/README.md) | `oauth2Plugin` | OAuth2 auth provider for Drupal `simple_oauth` |
| [`@dropsh/plugin-jsonapi-schema`](plugins/jsonapi-schema/README.md) | `jsonapiSchemaPlugin` | authoritative JSON Schema from Drupal `jsonapi_schema` |
| [`@dropsh/plugin-schemata`](plugins/schemata/README.md) | `schemataPlugin` | authoritative JSON Schema from Drupal `schemata` (legacy) |
| [`@dropsh/plugin-canvas`](plugins/canvas/README.md) | `canvasPlugin` | Canvas component schemas from `jsonapi_sdc` |
| [`@dropsh/plugin-display-builder`](plugins/display-builder/README.md) | `displayBuilderPlugin` | Display Builder operation schemas and metadata |

Basic auth is not a separate package — its `basicAuthPlugin` factory ships in the
core CLI's `dropsh/plugin` entry.

### Installing and resolving plugins

`@dropsh/plugin-*` packages are **not** dependencies of `dropsh` and are **not**
part of its tarball, so a global dropsh does not carry them. Install the ones you
use next to dropsh:

```bash
npm i -g dropsh @dropsh/plugin-oauth2        # globally, alongside a global dropsh
npx -p dropsh -p @dropsh/plugin-oauth2 dropsh …   # or one-off, no global install
```

A descriptor's `plugin` name is resolved like ESLint resolves its plugins, by
string name against these locations **in order**:

1. the directory of the `dropsh.config.js` file
2. the current working directory
3. dropsh's own install location

Location 3 is what lets a plugin installed globally next to a global `dropsh` be
found with no local project. If the name cannot be resolved from any of them,
dropsh reports which package to install.

`export` selects the factory to call and defaults to `"default"`. Every
`@dropsh/plugin-*` factory is a **named** export with **no default**, so a
descriptor for one of these packages **must** set `export` (e.g.
`export: "oauth2Plugin"` — see the table above). Basic auth uses
`{ plugin: "dropsh/plugin", export: "basicAuthPlugin" }`.

Plugin APIs are exported from `dropsh/plugin`:

```ts
import type { dropshPlugin } from "dropsh/plugin";

export function examplePlugin(): dropshPlugin {
  return {
    id: "example",
    requiredModules: [],
    async extendSchema(_entityType, _bundle, schema) {
      return schema;
    },
  };
}
```

Register a package plugin with a descriptor (no import needed), and a local
plugin either by descriptor (path name) or by importing it:

```js
import { examplePlugin } from "./plugins/example.js";

export default {
  site: { base_url: "https://my-drupal.example.com", jsonapi_prefix: "/jsonapi" },
  plugins: [
    { plugin: "dropsh/plugin", export: "basicAuthPlugin" }, // packaged, resolved by name
    examplePlugin(), // local module, imported directly
  ],
};
```

## Example Skills

A dropsh skill does not need to know every Drupal internal. Keep `SKILL.md` as a
small orchestrator that decides when the skill applies, which dropsh plugins are
expected, and which workflow file to load. Put the concrete command sequences,
schema checks, payload rules, and error handling into separate workflow files.

See [docs/examples/skills](docs/examples/skills/README.md) for three example
skill structures:

- Article publishing over standard JSON:API nodes
- Canvas pages driven by component schemas
- Display Builder pages driven by display metadata and override fields

## Development

```bash
pnpm test
pnpm run typecheck
pnpm run build
```

Integration tests require DDEV:

```bash
pnpm run drupal:up
pnpm run test:integration
pnpm run drupal:down
```

## Publishing

The CLI and workspace packages are published together from the `1.x` branch:

```bash
pnpm run release
```

Run `npm login` first. `prepublishOnly` runs typecheck and build before publish.
