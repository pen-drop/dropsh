# Integration Tests — Design

**Status:** Accepted
**Date:** 2026-04-22
**Depends on:** `2026-04-21-drupal-cli-design.md`

## 1. Goal

Add real integration tests for `drupal-cli` that exercise the full
CLI binary against a live Drupal 11 instance. Unit tests currently
cover the internal logic; these integration tests cover "does the
built binary actually talk to Drupal correctly over JSON:API".

Non-goals:

- Running these tests in CI (local-only).
- Load testing, performance benchmarking.
- Covering modes, skills, or markdown orchestration (out of scope for
  the CLI itself).

## 2. Prerequisite: Remove Unused Auth Adapters

Before any integration-test work, remove JWT and API-Key auth adapters.
They are not in scope for editorial workflows (OAuth2 is what real
sites use) and removing them shrinks the surface to test.

**Delete:**

- `src/core/auth/jwt.ts` and `tests/unit/core/auth/jwt.test.ts`
- `src/core/auth/api-key.ts` and `tests/unit/core/auth/api-key.test.ts`

**Update:**

- `src/core/auth/factory.ts` — remove `jwt` and `api_key` branches
- `src/core/auth/types.ts` — `AuthConfig` union reduced to
  `basic | oauth2_password | oauth2_client_credentials`
- `src/core/config.ts` — config parser validation
- `.drupal-cli.yml.example` — remove JWT/API-Key examples
- `README.md` — update auth section
- `docs/superpowers/specs/2026-04-21-drupal-cli-design.md` — update
  auth matrix

All existing unit tests must remain green after removal.

## 3. Directory Layout

```
tests/
  unit/                             # unchanged
  integrations/
    README.md                       # run / troubleshoot guide
    drupal/                         # DDEV project, committed
      .ddev/
        config.yaml                 # no name:, no ports
        .gitignore                  # ignores config.local.yaml
      composer.json
      composer.lock                 # committed → reproducible
      fixtures/
        install.sh                  # orchestrates provisioning
        setup-content-type.php      # drush php:script
        setup-oauth.php             # drush php:script
        setup-users.php             # drush php:script
      web/                          # .gitignore
      vendor/                       # .gitignore
    fixtures/
      hero.png                      # tiny dummy for upload-file tests
    bin/
      drupal-up.sh
      drupal-down.sh
    helpers/
      config.ts                     # reads .test-config.json
      run.ts                        # spawn helper + auth helpers
    read.test.ts
    search.test.ts
    create.test.ts
    update.test.ts
    delete.test.ts
    upload-file.test.ts
    auth-basic.test.ts
    auth-oauth2-password.test.ts
    auth-oauth2-client-credentials.test.ts

vitest.config.integration.ts
```

`.gitignore` additions (repo root):

```
tests/integrations/drupal/web/
tests/integrations/drupal/vendor/
tests/integrations/drupal/.ddev/config.local.yaml
tests/integrations/drupal/.test-config.json
```

## 4. Orchestration Commands

Added to `package.json`:

```json
"drupal:up":        "bash tests/integrations/bin/drupal-up.sh",
"drupal:down":      "bash tests/integrations/bin/drupal-down.sh",
"test:integration": "vitest run -c vitest.config.integration.ts"
```

Strict separation: `drupal:up` provisions, `test:integration` runs
tests, `drupal:down` tears down. Test runs never touch DDEV.

## 5. DDEV Config + Worktree Safety

`tests/integrations/drupal/.ddev/config.yaml`:

```yaml
type: drupal11
docroot: web
php_version: "8.3"
webserver_type: nginx-fpm
database:
  type: mariadb
  version: "10.11"
```

No `name:`, no hardcoded `router_http_port`/`router_https_port` —
DDEV picks free ports.

`drupal-up.sh` generates a worktree-unique project name before
`ddev start`:

```bash
HASH=$(pwd | sha1sum | cut -c1-8)
cat > tests/integrations/drupal/.ddev/config.local.yaml <<EOF
name: drupal-cli-test-${HASH}
EOF
```

`config.local.yaml` is gitignored. Result: multiple worktrees can run
DDEV simultaneously without collisions.

## 6. Drupal Fixture Setup

`composer.json` requires Drupal 11 core, `simple_oauth` ^6, `drush` ^13.
`composer.lock` is committed for reproducibility.

`bin/drupal-up.sh` flow:

1. Write `.ddev/config.local.yaml` (worktree-unique name)
2. `ddev start`
3. `ddev composer install`
4. `ddev drush site:install standard -y --account-name=admin --account-pass=admin`
5. `ddev drush en -y basic_auth jsonapi simple_oauth`
6. Generate `simple_oauth` RSA keypair in the container
7. `ddev drush php:script fixtures/setup-content-type.php`
8. `ddev drush php:script fixtures/setup-oauth.php`
9. `ddev drush php:script fixtures/setup-users.php`
10. Capture URL via `ddev describe -j`
11. Write `.test-config.json` with URL + credentials

### 6.1 Content Type

`fixtures/setup-content-type.php` creates content type
`article_test` with:

- `body` (via `node_add_body_field`)
- `field_test_text` (string) — used by create/update tests
- `field_image` (image) — used by upload-file tests

### 6.2 OAuth2 Consumers

Two separate consumers (realistic split, avoids grant-type confusion):

- Password grant consumer
- Client-credentials grant consumer

Credentials are generated in `setup-oauth.php` and written to
`.test-config.json` by `install.sh`.

### 6.3 Test User

One non-admin user `tester` with a role that can create/edit/delete
`article_test` nodes. Used for both basic auth and OAuth2 password
grant.

## 7. Handover File

`tests/integrations/drupal/.test-config.json`:

```json
{
  "url": "https://drupal-cli-test-<hash>.ddev.site",
  "basic":  { "user": "tester", "pass": "tester-pw" },
  "oauth2": {
    "password_client_id":     "<uuid>",
    "password_client_secret": "<hex>",
    "cc_client_id":           "<uuid>",
    "cc_client_secret":       "<hex>",
    "user": "tester",
    "pass": "tester-pw"
  }
}
```

Gitignored. Written by `drupal-up.sh`, read by `helpers/config.ts`.

## 8. Test Helpers

### 8.1 `helpers/config.ts`

```ts
export interface TestConfig { /* shape of .test-config.json */ }
export function testConfig(): TestConfig;
```

Reads `.test-config.json` synchronously on each call. Throws a clear
error ("Integration tests require running DDEV. Run: npm run drupal:up")
if the file is missing.

### 8.2 `helpers/run.ts`

```ts
type Auth =
  | { type: "basic"; user: string; pass: string }
  | { type: "oauth2_password"; clientId: string; clientSecret: string;
      user: string; pass: string }
  | { type: "oauth2_client_credentials"; clientId: string; clientSecret: string };

export interface RunResult { code: number; stdout: string; stderr: string; }

export async function runCli(opts: {
  url: string; auth: Auth; args: string[];
}): Promise<RunResult>;

export function parseJson(stdout: string): unknown;

export function basicAuth(): Auth;
export function oauth2Password(): Auth;
export function oauth2ClientCred(): Auth;

export async function createTestNode(title: string): Promise<string>;
```

`runCli` behavior:

1. Create temp dir, write a temp `.drupal-cli.yml` with the given URL
   and auth
2. `spawn("node", ["bin/drupal-cli", ...args], { env: {..., DRUPAL_CLI_CONFIG: <path>} })`
3. Collect stdout/stderr/exit code
4. Return `RunResult`

This tests the real entry point — no mocks, no injected deps.

## 9. Test Runner Config

`vitest.config.integration.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integrations/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    sequence: { concurrent: false },
    fileParallelism: false,
  },
});
```

Single-threaded, serial — writes share the same Drupal instance.

## 10. Test Coverage

Exit code reference (from `src/errors.ts` `exitCodeFor`):
`0` = ok, `1` = generic, `2` = ConfigError, `3` = AuthError,
`4` = ValidationError, `5` = HttpError.

### 10.1 Per Command (basic auth, as default)

**`read.test.ts`**

- `read node/article_test/<uuid>` → exit 0, JSON with matching `id`
- `read node/article_test/<valid-but-unknown-uuid>` → exit 5 (HttpError,
  Drupal 404), error JSON on stderr

**`search.test.ts`**

- `search node --bundle=article_test --limit=5` → ≤5 results
- `search node --bundle=article_test --filter=title:<unique>` → 1 hit
- `search node --bundle=article_test --filter=status:=:1 --limit=2`
  → only published

**`create.test.ts`**

- `create node --bundle=article_test --data='{"data":{"type":"node--article_test","attributes":{"title":"<unique>"}}}'`
  → exit 0, server-assigned UUID in stdout; follow-up `search` by the
  unique title finds exactly 1 hit
- `--dry-run` with the same payload → exit 0; follow-up `search` by the
  same unique title returns 0 hits (no write happened)
- `--data=@<file>` → same result as inline for an identical payload

**`update.test.ts`**

- `update node/article_test/<uuid> --data='{...}'` → exit 0, follow-up
  `read` shows new value
- `--dry-run` → follow-up `read` shows unchanged value

**`delete.test.ts`**

- `delete node/article_test/<uuid>` → exit 0; follow-up `read` → exit 5
  (HttpError 404)
- `--dry-run` → exit 0; follow-up `read` still succeeds

**`upload-file.test.ts`**

- `upload-file --target=node/article_test/<uuid>/field_image --file=<png>`
  → exit 0, file UUID in stdout, follow-up `read` shows relationship
- `--file=<nonexistent>` → exit 4 (ValidationError)

### 10.2 Per Auth Adapter (smoke)

**`auth-basic.test.ts`**

- Wrong password → exit 3 (auth error)

(Happy path is covered by command tests above.)

**`auth-oauth2-password.test.ts`**

- `read <uuid>` with password-grant config → exit 0
- Wrong password → exit 3

**`auth-oauth2-client-credentials.test.ts`**

- `read <uuid>` with client-credentials config → exit 0
- Wrong client secret → exit 3

### 10.3 Test Data Convention

Each test creates the entities it needs. No shared fixtures between
tests beyond what `install.sh` provisions (content type, users,
consumers). Tests may clean up their own entities via the CLI `delete`
command when convenient but are not required to — Drupal is torn down
by `drupal:down`.

## 11. CI Strategy

**Not run in CI.** Local-only.

Rationale:

- DDEV in CI is expensive (~2 min per run, requires Docker-in-Docker)
- Unit tests already cover CLI logic; integration tests cover
  end-to-end against real Drupal
- Individual devs run them before larger refactors and releases

Future CI integration can be a separate follow-up.

## 12. Documentation

### 12.1 `tests/integrations/README.md` (new)

Covers: prerequisites (DDEV), `drupal:up` / `test:integration` /
`drupal:down`, how the handover file works, troubleshooting (DDEV
port collisions across worktrees, "DDEV not running" errors, how to
inspect the running site with `ddev describe`).

### 12.2 Repo-root `README.md`

Add three new lines to the Development block plus a one-line pointer
to `tests/integrations/README.md`.
