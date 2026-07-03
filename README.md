# dropsh

Entity-agnostic helper CLI for Drupal 11 JSON:API. Written in TypeScript, used directly by the `dropsh` Claude skill for editorial publishing workflows.

This is the foundation CLI. Discovery, schema generation, and the skill layer are delivered by follow-up plans.

## Install

```bash
npm install
npm run build
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
dropsh read <entity_type>/<bundle>/<uuid> [--include=<field>,…]
dropsh search <entity_type> [--bundle=<b>] [--filter=key:value]… [--limit=N] [--include=<field>,…]
dropsh create <entity_type> --bundle=<b> --data=<json|@file> [--dry-run] [--no-validate]
dropsh update <entity_type>/<bundle>/<uuid> --data=<json|@file> [--dry-run] [--no-validate]
dropsh delete <entity_type>/<bundle>/<uuid> [--dry-run]
dropsh upload-file --target=<entity_type>/<bundle>/<uuid>/<field> --file=<path> [--dry-run]
dropsh schema [--refresh]
dropsh schema <entity_type>/<bundle> [--for=create|update] [--refresh]
```

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

### `schema`

Without a target, prints the list of available `<entity_type>/<bundle>` targets on the site.

With a target (e.g. `node/article`), prints a JSON Schema document that validates a JSON:API request body for that resource.

- `--for=create` (default) / `--for=update` — operation variant (update clears required fields)
- `--refresh` — bypass the cache for this call

If the site has `drupal/schemata` + `drupal/schemata_json_schema` installed, the schema is authoritative (required fields, constraints). Otherwise, a shallow schema is returned from sample records with a warning on stderr (field names only, no required fields, no constraints). The output carries `x-dropsh-source: "schemata" | "heuristic" | "heuristic-empty"` so consumers can tell how strict the schema is.

Schemas are cached under `.dropsh/cache/` next to your `.dropsh.yml`. The `.dropsh/` directory is gitignored.

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

### Client-side validation in `create` / `update`

`dropsh create` and `dropsh update` run the payload through the bundle's schema before sending it. A validation failure exits with code 4 (`E_VALIDATION`) and emits the Ajv errors on stderr without issuing an HTTP request. Pass `--no-validate` to skip the check.

## Development

```bash
npm test            # Vitest unit suite
npm run test:watch
npm run typecheck
npm run build
```

### Integration tests

Local-only, requires DDEV. See `tests/integrations/README.md`.

```bash
npm run drupal:up
npm run test:integration
npm run drupal:down
```

See `docs/superpowers/specs/2026-04-21-dropsh-design.md` for the full design.
