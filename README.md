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

This repository is a pnpm workspace containing the root CLI, packages, and
plugins.

```bash
corepack enable
pnpm install
pnpm run build
```

The required Node.js and pinned pnpm versions are declared in `package.json`.

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
| Authoritative schemas | `schemata`, `jsonapi_schema` |
| Canvas schemas | `canvas`, `jsonapi_sdc` |
| Display Builder schemas | `display_builder`, `display_builder_entity_view`, `jsonapi_sdc` |

## Configuration

Create a `dropsh.config.js` in the project where you run dropsh. The config holds
only non-secret connection settings. Passwords, client secrets, and tokens are
prompted during login and stored outside the project in the per-host session
store.

```js
import { basicAuthPlugin } from "dropsh";
import { oauth2Plugin } from "@dropsh/plugin-oauth2";
import { schemataPlugin } from "@dropsh/plugin-schemata";

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
    basicAuthPlugin(),
    oauth2Plugin({
      type: "oauth2_authcode",
      client_id: "my-client",
      token_url: "https://my-drupal.example.com/oauth/token",
    }),
    schemataPlugin(),
  ],
};
```

Use `dropsh.config.example.js` as a fuller starting point. Override the config
path with `--config <path>` or `DROPSH_CONFIG`.

## Authentication

Authentication is configured through plugins. Each plugin that contributes an
auth provider appears as a login option.

```bash
dropsh auth login
dropsh auth login --provider basic
dropsh auth status
dropsh auth logout
```

Secrets and tokens are never written to `dropsh.config.js`. The active session is
stored per host under `~/.config/dropsh/<host>.json` with file mode `0600`.

## Commands

All commands write JSON to stdout, structured errors to stderr, and use stable
exit codes.

```bash
dropsh read <entity_type>/<bundle>/<uuid>
dropsh search <entity_type> [--bundle=<bundle>] [--filter=key:value] [--limit=N]
dropsh create <entity_type> --bundle=<bundle> --data=<json|@file> [--dry-run]
dropsh update <entity_type>/<bundle>/<uuid> --data=<json|@file> [--dry-run]
dropsh delete <entity_type>/<bundle>/<uuid> [--dry-run]
dropsh upload-file --target=<entity_type>/<bundle>/<uuid>/<field> --file=<path>
dropsh schema [--refresh]
dropsh schema <entity_type>/<bundle> [--for=create|update] [--refresh]
```

`create` and `update` validate payloads against the current schema by default.
Pass `--no-validate` when you intentionally want to skip local validation.

## Plugins

Plugins are regular JavaScript or TypeScript modules that return a `DropSHPlugin`.
A plugin can contribute one or more of these capabilities:

- an auth provider
- schema extensions
- operation-specific schema changes for `create` or `update`
- additional CLI commands

Schema plugins are the main way to make dropsh useful for agents on real sites.
They can add required fields, component definitions, builder-specific structures,
allowed values, and other metadata that helps the agent produce a valid payload.
Auth plugins keep the same command interface while supporting common Drupal
authentication systems such as basic auth or OAuth2.

Bundled plugins:

| Package | Purpose |
| --- | --- |
| [`@dropsh/plugin-oauth2`](plugins/oauth2/README.md) | OAuth2 auth provider for Drupal `simple_oauth` |
| [`@dropsh/plugin-schemata`](plugins/schemata/README.md) | authoritative JSON Schema source from Drupal `schemata` |
| [`@dropsh/plugin-canvas`](plugins/canvas/README.md) | Canvas component schemas from `jsonapi_sdc` |
| [`@dropsh/plugin-display-builder`](plugins/display-builder/README.md) | Display Builder operation schemas and metadata |

Plugin APIs are exported from `dropsh/plugin`:

```ts
import type { DropSHPlugin } from "dropsh/plugin";

export function examplePlugin(): DropSHPlugin {
  return {
    id: "example",
    requiredModules: [],
    async extendSchema(_entityType, _bundle, schema) {
      return schema;
    },
  };
}
```

Register local or package plugins in `dropsh.config.js`:

```js
import { basicAuthPlugin } from "dropsh";
import { examplePlugin } from "./plugins/example.js";

export default {
  site: { base_url: "https://my-drupal.example.com", jsonapi_prefix: "/jsonapi" },
  plugins: [basicAuthPlugin(), examplePlugin()],
};
```

## Example Skill

A dropsh skill does not need to know Drupal internals. It can describe when to use
the CLI, which config to load, and which commands to run for a workflow.

Minimal starting point for your own skill:

```md
# Drupal Publishing Skill

Use dropsh for Drupal content operations.

## Setup

- Run commands from the project that contains `dropsh.config.js`.
- If authentication is missing, run `dropsh auth login`.
- Use `dropsh schema <entity_type>/<bundle> --for=create` before creating new
  content.

## Workflow

1. Search existing content with `dropsh search`.
2. Read full records with `dropsh read`.
3. Validate planned payloads against `dropsh schema`.
4. Create or update with `dropsh create` or `dropsh update`.
5. Use `--dry-run` before destructive or high-impact changes.
```

Keep the skill focused on the workflow and let dropsh handle transport,
authentication, schemas, and validation.

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
