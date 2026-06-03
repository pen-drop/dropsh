# dropsh

Entity-agnostic helper CLI for Drupal 11 JSON:API. Written in TypeScript, used directly by the `dropsh` Claude skill for editorial publishing workflows.

This is the foundation CLI. Discovery, schema generation, and the skill layer are delivered by follow-up plans.

## Install

This is a [pnpm](https://pnpm.io) workspace (root CLI + `plugins/*` + `playground`).
The pinned pnpm version is declared in `package.json` (`packageManager`); enable it with
`corepack enable`.

```bash
pnpm install
pnpm run build
```

## Configure

Copy `.dropsh.yml.example` to `.dropsh.yml` in your project and set the auth fields. Secrets are referenced as `${ENV_VAR}` and expanded at load time.

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

Schemas are cached under `.dropsh/cache/` next to your `.dropsh.yml`. The `.dropsh/` directory is gitignored.

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

The CLI and both plugins are published together with a single command:

```bash
pnpm run release
```

This publishes `dropsh` (workspace root) plus `@dropsh/plugin-oauth2` and
`@dropsh/plugin-schemata` (`plugins/*`). `prepublishOnly` runs typecheck + build
for each package; scoped plugins publish with public access via their
`publishConfig`. Log in first with `npm login`.

See `docs/superpowers/specs/2026-04-21-dropsh-design.md` for the full design.
