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

If you want to run the integration suite against a DDEV `https://...ddev.site` URL without fixing local CA trust for Node first:

```bash
npm run drupal:up
npm run test:integration:https-insecure
npm run drupal:down
```

## How It Works

`drupal:up` provisions a fresh Drupal 11 site inside DDEV, enables `basic_auth`, `jsonapi`, and `simple_oauth`, creates an `article_test` content type, creates two OAuth2 consumers, and writes the live DDEV URL + credentials to `tests/integrations/drupal/.test-config.json`.

Each test spawns `node bin/drupal-cli` as a subprocess with a temporary `.drupal-cli.yml` pointing at that DDEV URL, then asserts on exit code, stdout JSON, and stderr.

## Troubleshooting

- "Integration tests require a running DDEV" means `npm run drupal:up` has not been run.
- If state gets stale, run `npm run drupal:down` and then `npm run drupal:up` again.
- From `tests/integrations/drupal/`, `ddev describe` shows the live URL. Admin login is `admin / admin`, test user is `tester / tester-pw`.
- `NODE_TLS_REJECT_UNAUTHORIZED=0` disables TLS certificate verification for the Node process. Use it only for local DDEV testing.
