# Integration Tests

Real Drupal 11 over DDEV. Local-only, not run in CI.

## Prerequisites

- DDEV installed locally
- Docker running
- `node >= 20`

## Running

```bash
pnpm run drupal:up
pnpm run test:integration
pnpm run drupal:down
```

## How It Works

`drupal:up` provisions a fresh Drupal 11 site inside DDEV with `basic_auth`, `jsonapi`, `simple_oauth`, `schemata`, and `schemata_json_schema` enabled. It creates an `article_test` content type, two OAuth2 consumers, and writes the live DDEV URL + credentials to `tests/integrations/drupal/.test-config.json`.

Each test spawns `node bin/dropsh-src` as a subprocess with a temporary `dropsh.config.mjs` pointing at that DDEV URL, then asserts on exit code, stdout JSON, and stderr. The subprocess runs with `NODE_TLS_REJECT_UNAUTHORIZED=0` so DDEV's self-signed HTTPS certificates are accepted without touching the host CA trust store.

Auth follows the real provider-login flow: `seedSession()` (in `helpers/run.ts`) drives the matching `AuthProvider.login(ctx)` against the live site with a stub `prompt` that returns the fixture secret, then persists the resulting session under a throwaway `HOME`. `runCli` launches the CLI with that `HOME` so the runtime resolver reads the seeded `~/.config/dropsh/<host>.json` session. The rendered config carries only non-secret connection params — no passwords, client secrets, or tokens. The `oauth2_authcode` (browser PKCE) flow is not seeded automatically; run it by hand with `dropsh auth login --provider oauth2_authcode` against the plain site.

## Troubleshooting

- "Integration tests require a running DDEV" means `pnpm run drupal:up` has not been run.
- If state gets stale, run `pnpm run drupal:down` and then `pnpm run drupal:up` again.
- From `tests/integrations/drupal/`, `ddev describe` shows the live URL. Admin login is `admin / admin`, test user is `tester / tester-pw`.
