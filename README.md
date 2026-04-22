# drupal-cli

Entity-agnostic helper CLI for Drupal 11 JSON:API. Written in TypeScript, used directly by the `drupal-cli` Claude skill for editorial publishing workflows.

This is the foundation CLI. Discovery, schema generation, and the skill layer are delivered by follow-up plans.

## Install

```bash
npm install
npm run build
```

## Configure

Copy `.drupal-cli.yml.example` to `.drupal-cli.yml` in your project and set the auth fields. Secrets are referenced as `${ENV_VAR}` and expanded at load time.

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
drupal-cli read <entity_type>/<bundle>/<uuid>
drupal-cli search <entity_type> [--bundle=<b>] [--filter=key:value]… [--limit=N]
drupal-cli create <entity_type> --bundle=<b> --data=<json|@file> [--dry-run]
drupal-cli update <entity_type>/<bundle>/<uuid> --data=<json|@file> [--dry-run]
drupal-cli delete <entity_type>/<bundle>/<uuid> [--dry-run]
drupal-cli upload-file --target=<entity_type>/<bundle>/<uuid>/<field> --file=<path> [--dry-run]
```

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

See `docs/superpowers/specs/2026-04-21-drupal-cli-design.md` for the full design.
