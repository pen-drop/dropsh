# Rename: drupal-cli → dropsh

**Date:** 2026-05-06  
**Status:** Approved

## Background

The name `drupal-cli` / `drupal_cli` conflicts with Drupal trademark guidelines. The project
needs a new identity that is independent of the Drupal trademark while still being meaningful
to the Drupal community.

The chosen name is **`dropsh`** — a deliberate analogy to `drush` ("Drupal Shell"):

- Drupal's mascot is a water drop (Druplicon)
- The primary action of this tool is "dropping" (publishing) content into Drupal
- `dropsh` = "Drop Shell", paralleling `drush` = "Drupal Shell"

The project will also move to a new repository (away from `git.drupal.org`).

## Rename Map

| Artifact | Old | New |
|---|---|---|
| npm package name | `drupal-cli` | `dropsh` |
| Binary | `drupal-cli` | `dropsh` |
| Plugin npm scope | `@drupal-cli/` | `@dropsh/` |
| Plugin: schemata | `@drupal-cli/plugin-schemata` | `@dropsh/plugin-schemata` |
| Plugin: oauth2 | `@drupal-cli/plugin-oauth2` | `@dropsh/plugin-oauth2` |
| Environment variable | `DRUPAL_CLI_CONFIG` | `DROPSH_CONFIG` |
| Cache directory | `.drupal-cli/cache` | `.dropsh/cache` |
| Config file | `drupal-cli.config.js` | `dropsh.config.js` |
| JSON Schema extension keys | `x-drupal-cli-*` | `x-dropsh-*` |
| Plugin import path | `drupal-cli/plugin` | `dropsh/plugin` |
| Binary source entry | `bin/drupal-cli-src` | `bin/dropsh-src` |
| Repository URL | `git.drupal.org/project/drupal_cli` | new project (TBD) |

## Files to Change

### Root package

- `package.json` — name, bin key, description, repository URL
- `bin/drupal-cli` → rename to `bin/dropsh`
- `bin/drupal-cli-src` → rename to `bin/dropsh-src`
- `drupal-cli.config.example.js` → rename to `dropsh.config.example.js`
- `README.md` — all references
- `CLAUDE.md` — all references

### Source (`src/`)

- `src/index.ts` — `DRUPAL_CLI_CONFIG`, `.drupal-cli/cache`, `x-drupal-cli-*`, `.name("drupal-cli")`
- `src/commands/schema.ts` — `.drupal-cli/cache`, `x-drupal-cli-*`
- `src/core/schema/jsonschema-source.ts` — error message referencing `drupal-cli schema`

### Plugins

- `plugins/schemata/package.json` — name, peer dep
- `plugins/schemata/src/index.ts` — import from `drupal-cli/plugin`
- `plugins/schemata/src/schemata.ts` — import from `drupal-cli/plugin`
- `plugins/schemata/vitest.config.ts` — alias `drupal-cli/plugin`
- `plugins/oauth2/package.json` — name, peer dep
- `plugins/oauth2/src/token-store.ts` — `.config/drupal-cli` path
- `plugins/oauth2/tests/**` — imports and temp dir names

### Tests

- `tests/unit/index.test.ts` — `parseAsync(["node", "drupal-cli", ...])`
- `tests/unit/smoke.test.ts` — same
- `tests/unit/commands/schema.test.ts` — temp dir prefix, `x-drupal-cli-*` key assertions
- `tests/unit/core/cache/file-store.test.ts` — temp dir prefix
- `tests/integrations/helpers/run.ts` — `DRUPAL_CLI_CONFIG`, temp dir, bin path
- `tests/integrations/create.test.ts` — temp dir prefix
- `tests/integrations/schema/**` — `x-drupal-cli-*` key assertions

### Docs

- `docs/superpowers/specs/*.md` — references to old name (non-normative, best-effort)

## Out of Scope

- Skill files (separate repository / plugin)
- Mode markdowns under `modes/`
- Functional behaviour changes — this is a pure rename

## Success Criteria

- `npm run lint`, `npm run typecheck`, `npm test` all pass after rename
- Binary `dropsh` is callable and behaves identically to old `drupal-cli`
- Plugin imports resolve via `dropsh/plugin`
- Cache and config paths use `.dropsh/` and `DROPSH_CONFIG`
- JSON Schema extension keys use `x-dropsh-*`
