# Integration Tests

Real Drupal 11 over DDEV. Local-only, not run in CI.

## Prerequisites

- DDEV installed locally
- Docker running
- `node >= 20`

## Running

```bash
npm run drupal:up
npm run test:integration
npm run drupal:down
```

## How It Works

`drupal:up` provisions a fresh Drupal 11 site inside DDEV with `basic_auth`, `jsonapi`, `simple_oauth`, `schemata`, and `schemata_json_schema` enabled. It creates an `article_test` content type, two OAuth2 consumers, and writes the live DDEV URL + credentials to `tests/integrations/drupal/.test-config.json`.

Each test spawns `node bin/dropsh` as a subprocess with a temporary `.dropsh.yml` pointing at that DDEV URL, then asserts on exit code, stdout JSON, and stderr. The subprocess runs with `NODE_TLS_REJECT_UNAUTHORIZED=0` so DDEV's self-signed HTTPS certificates are accepted without touching the host CA trust store.

## Troubleshooting

- "Integration tests require a running DDEV" means `npm run drupal:up` has not been run.
- If state gets stale, run `npm run drupal:down` and then `npm run drupal:up` again.
- From `tests/integrations/drupal/`, `ddev describe` shows the live URL. Admin login is `admin / admin`, test user is `tester / tester-pw`.
