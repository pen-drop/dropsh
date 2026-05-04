# Single Schemata Fixture — Integration Test Consolidation

**Date:** 2026-05-04
**Status:** Approved

## Problem

Integration tests currently run against two separate DDEV fixtures:

- `tests/integrations/drupal/` — plain Drupal 11, no schemata module
- `tests/integrations/drupal-schemata/` — Drupal 11 with `schemata` + `schemata_json_schema`

This duplication causes:
- Two sets of npm scripts (`drupal:up`, `drupal-schemata:up`)
- Two helper functions (`runCli`, `runCliSchemata`) and two config readers (`testConfig`, `testConfigSchemata`)
- Tests split across both fixtures without a clear policy on which to use

## Decision

Consolidate to a single integration fixture that always has the schemata module installed. The non-schemata heuristic fallback is an internal concern and does not require its own DDEV environment to test at integration level.

## Design

### 1. Fixture

`tests/integrations/drupal-schemata/` is renamed to `tests/integrations/drupal/`. The old `tests/integrations/drupal/` directory is deleted.

The fixture always has `schemata` and `schemata_json_schema` enabled.

### 2. Shell Scripts

| Before | After |
|---|---|
| `bin/drupal-schemata-up.sh` | replaces `bin/drupal-up.sh` |
| `bin/drupal-schemata-down.sh` | replaces `bin/drupal-down.sh` |
| `bin/drupal-schemata-up.sh` | deleted |
| `bin/drupal-schemata-down.sh` | deleted |

### 3. npm Scripts (`package.json`)

`drupal-schemata:up` and `drupal-schemata:down` are removed. `drupal:up` and `drupal:down` remain and point to the renamed fixture directory.

### 4. Helpers

**`tests/integrations/helpers/config.ts`**
- `testConfigSchemata()` is removed
- `testConfig()` reads from `tests/integrations/drupal/.test-config.json` (unchanged path after rename)

**`tests/integrations/helpers/run.ts`**
- `runCliSchemata()` is removed
- `runCli()` takes over its implementation, keeping `NODE_TLS_REJECT_UNAUTHORIZED: "0"` (DDEV uses self-signed TLS certificates; no CA configuration desired)
- `createTestNode()` is unchanged

### 5. Test Adaptations

Tests that used `runCliSchemata` (`schema-jsonschema-create`, `schema-jsonschema-update`, `schema-validates-create-payload`) update their import to `runCli` — no other changes.

Tests that used `runCli` against the old non-schemata fixture (`create`, `delete`, `read`, `search`, `auth-*`, `schema-cache-persistence`, `schema-list`, `schema-unknown-target`) — no changes, `runCli` now points at the schemata fixture automatically.

Heuristic tests are adapted as follows:

| File | Change |
|---|---|
| `schema-refresh.integration.test.ts` | Remove `expect(third.stderr).toMatch(/no 'schemata' module/)`, assert `stderr` is empty instead |
| `schema-heuristic.integration.test.ts` | Renamed to `schema-source.integration.test.ts`; rewrites assertions to expect `x-drupal-cli-source: "schemata"` and empty stderr |
| `schema-heuristic-empty-bundle.integration.test.ts` | Renamed to `schema-empty-bundle.integration.test.ts`; asserts `x-drupal-cli-source: "schemata"` for a bundle with no instances |

### 6. README

`tests/integrations/README.md` is updated to document only `drupal:up` / `drupal:down` and to mention that the fixture includes the schemata module.

## Out of Scope

- Unit tests for the heuristic fallback path — those remain as-is
- Any changes to the CLI source code
- CI configuration (integration tests are local-only)
