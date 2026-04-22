# Integration Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local-only DDEV-based integration tests that exercise all six CLI subcommands and the three remaining auth adapters (basic, oauth2_password, oauth2_client_credentials) against a real Drupal 11 instance.

**Architecture:** A hand-provisioned DDEV Drupal project lives under `tests/integrations/drupal/`. Shell scripts in `tests/integrations/bin/` bring it up/down and write a `.test-config.json` handover file with URL + credentials. Vitest tests in `tests/integrations/` spawn `node bin/drupal-cli` as a subprocess (one test-specific temp config per run) and assert on exit code + stdout JSON + stderr. Prerequisite cleanup removes the unused JWT and API-Key auth adapters before the integration work starts.

**Tech Stack:** DDEV, Drupal 11 (`drupal/core-recommended`), `drupal/simple_oauth` ^6, Drush ^13, Vitest (subprocess tests), Node.js `child_process.spawn`, TypeScript/ESM.

**Spec:** `docs/superpowers/specs/2026-04-22-integration-tests-design.md`

---

## Task 1: Remove JWT and API-Key auth adapters

Prerequisite cleanup. Editorial workflows only need basic + OAuth2, and fewer auth variants means fewer integration-test permutations.

**Files:**
- Delete: `src/core/auth/jwt.ts`
- Delete: `src/core/auth/api-key.ts`
- Delete: `tests/unit/core/auth/jwt.test.ts`
- Delete: `tests/unit/core/auth/api-key.test.ts`
- Modify: `src/core/auth/factory.ts`
- Modify: `src/core/config.ts`
- Modify: `tests/unit/core/auth/factory.test.ts`
- Modify: `docs/superpowers/specs/2026-04-21-drupal-cli-design.md`

- [ ] **Step 1: Delete the two adapter source files and their unit tests**

```bash
rm src/core/auth/jwt.ts src/core/auth/api-key.ts \
   tests/unit/core/auth/jwt.test.ts tests/unit/core/auth/api-key.test.ts
```

- [ ] **Step 2: Update `src/core/auth/factory.ts` — remove imports and branches**

Rewrite the file to this exact content:

```ts
import type { AuthConfig } from "../config.js";
import type { HttpClient } from "../http.js";
import { AuthError } from "../../errors.js";
import type { AuthAdapter } from "./types.js";
import { createBasicAuth } from "./basic.js";
import { createOAuth2Auth } from "./oauth2.js";

export interface AuthFactoryDeps {
  http: HttpClient;
  baseUrl: string;
}

export function createAuthAdapter(cfg: AuthConfig, deps: AuthFactoryDeps): AuthAdapter {
  switch (cfg.type) {
    case "basic":
      return createBasicAuth(cfg);
    case "oauth2_password":
    case "oauth2_client_credentials":
      return createOAuth2Auth(cfg, { http: deps.http, baseUrl: deps.baseUrl });
    default:
      throw new AuthError(`Unknown auth.type: ${String(cfg.type)}`);
  }
}
```

- [ ] **Step 3: Update `AuthConfig.type` union in `src/core/config.ts`**

Replace the `AuthConfig` interface (lines 5–8) with:

```ts
export interface AuthConfig {
  type: "basic" | "oauth2_password" | "oauth2_client_credentials";
  [key: string]: unknown;
}
```

Leave everything else in `config.ts` unchanged.

- [ ] **Step 4: Update `tests/unit/core/auth/factory.test.ts` — remove JWT and API-Key cases**

Replace the file with:

```ts
import { describe, expect, it } from "vitest";
import { createAuthAdapter } from "../../../../src/core/auth/factory.js";
import { AuthError } from "../../../../src/errors.js";
import type { HttpClient } from "../../../../src/core/http.js";

const http: HttpClient = { send: async () => ({ status: 200, headers: {}, body: "{}" }) };

describe("auth factory", () => {
  it("creates basic adapter", async () => {
    const a = createAuthAdapter({ type: "basic", username: "u", password: "p" }, { http, baseUrl: "https://x" });
    const req = await a.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.Authorization).toMatch(/^Basic /);
  });

  it("creates oauth2 adapter", () => {
    const a = createAuthAdapter(
      { type: "oauth2_client_credentials", client_id: "c", client_secret: "s" },
      { http, baseUrl: "https://x" },
    );
    expect(a.apply).toBeTypeOf("function");
  });

  it("throws on unknown type", () => {
    expect(() => createAuthAdapter({ type: "weird" } as any, { http, baseUrl: "https://x" })).toThrow(AuthError);
  });
});
```

- [ ] **Step 5: Update the design spec auth matrix**

In `docs/superpowers/specs/2026-04-21-drupal-cli-design.md`, replace the block at lines 365–371 with:

```
**Supported `auth.type` values (MVP):**

- `basic` — username + password via HTTP Basic
- `oauth2_password` — Simple OAuth, password grant, token cached under `~/.cache/drupal-cli/tokens.json`
- `oauth2_client_credentials` — service accounts

> **History:** JWT and API-Key adapters were removed on 2026-04-22 — editorial workflows did not use them. See `docs/superpowers/specs/2026-04-22-integration-tests-design.md` §2.
```

And at lines 525–528, remove the two lines `jwt.ts` and `api-key.ts` from the directory tree so only `basic.ts` and `oauth2.ts` remain under `auth/`.

- [ ] **Step 6: Run typecheck + unit tests**

```bash
npm run typecheck && npm test
```

Expected: typecheck passes, all remaining tests green (no references to jwt.ts or api-key.ts left).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(auth): remove unused jwt and api_key adapters

Editorial workflows only use basic and OAuth2. Fewer adapters means
fewer integration-test permutations. Part of the integration-tests
implementation plan — prerequisite cleanup.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Update `.gitignore` for new integration paths

The existing `.gitignore` has entries for `tests/drupal/` (old path). The spec puts DDEV at `tests/integrations/drupal/`. Also add the handover file.

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Rewrite the DDEV block in `.gitignore`**

Find the block starting with `# Per-worktree DDEV override` (~line 16) and the block `# DDEV-generated Drupal project contents`. Replace both with:

```
# Per-worktree DDEV override
tests/integrations/drupal/.ddev/config.local.yaml
tests/integrations/drupal/.ddev/.ddev-docker-*
tests/integrations/drupal/.ddev/db_snapshots/
tests/integrations/drupal/.ddev/import-db/

# DDEV-generated Drupal project contents (regenerated by composer install)
tests/integrations/drupal/web/
tests/integrations/drupal/vendor/

# Integration-test handover file (contains live credentials)
tests/integrations/drupal/.test-config.json
```

- [ ] **Step 2: Verify and commit**

```bash
git diff .gitignore
git add .gitignore
git commit -m "chore(gitignore): point DDEV ignores at tests/integrations/

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: DDEV config

**Files:**
- Create: `tests/integrations/drupal/.ddev/config.yaml`
- Create: `tests/integrations/drupal/.ddev/.gitignore`

- [ ] **Step 1: Create the DDEV config**

```yaml
# tests/integrations/drupal/.ddev/config.yaml
type: drupal11
docroot: web
php_version: "8.3"
webserver_type: nginx-fpm
database:
  type: mariadb
  version: "10.11"
```

No `name:` and no hardcoded router ports — the orchestration script writes `config.local.yaml` with a worktree-unique name and DDEV picks free ports.

- [ ] **Step 2: Create the DDEV-local `.gitignore`**

```
# tests/integrations/drupal/.ddev/.gitignore
config.local.yaml
```

- [ ] **Step 3: Commit**

```bash
git add tests/integrations/drupal/.ddev/
git commit -m "chore(ddev): base config for integration-test Drupal

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Drupal project `composer.json`

**Files:**
- Create: `tests/integrations/drupal/composer.json`
- Create: `tests/integrations/drupal/composer.lock` (generated inside DDEV, committed)

- [ ] **Step 1: Write `composer.json`**

```json
{
  "name": "drupal-cli/integration-fixture",
  "description": "Drupal 11 fixture for drupal-cli integration tests. Local-only.",
  "type": "project",
  "license": "GPL-2.0-or-later",
  "minimum-stability": "stable",
  "prefer-stable": true,
  "require": {
    "composer/installers": "^2",
    "drupal/core-composer-scaffold": "^11",
    "drupal/core-recommended": "^11",
    "drupal/simple_oauth": "^6",
    "drush/drush": "^13"
  },
  "config": {
    "allow-plugins": {
      "composer/installers": true,
      "drupal/core-composer-scaffold": true,
      "cweagans/composer-patches": true
    },
    "sort-packages": true
  },
  "extra": {
    "drupal-scaffold": {
      "locations": { "web-root": "web/" }
    },
    "installer-paths": {
      "web/core":                   ["type:drupal-core"],
      "web/libraries/{$name}":      ["type:drupal-library"],
      "web/modules/contrib/{$name}":["type:drupal-module"],
      "web/profiles/contrib/{$name}":["type:drupal-profile"],
      "web/themes/contrib/{$name}": ["type:drupal-theme"]
    }
  }
}
```

- [ ] **Step 2: Generate `composer.lock` inside DDEV**

Requires DDEV installed. If DDEV is not available on this host, stop here and ask the user to run these steps on a host that has it:

```bash
cd tests/integrations/drupal
mkdir -p .ddev
# Temporary name just for lockfile generation; ignored by real runs.
printf 'name: drupal-cli-lockgen\n' > .ddev/config.local.yaml
ddev start
ddev composer install --no-interaction
ddev stop --unlist
rm .ddev/config.local.yaml
```

Expected: `composer.lock` appears next to `composer.json`; `web/` and `vendor/` also appear (both gitignored).

- [ ] **Step 3: Commit**

```bash
git add tests/integrations/drupal/composer.json tests/integrations/drupal/composer.lock
git commit -m "chore(fixture): composer.json + lockfile for Drupal 11 + simple_oauth

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Fixture script — content type

Creates the `article_test` content type with two extra fields (`field_test_text` for create/update, `field_image` for upload-file).

**Files:**
- Create: `tests/integrations/drupal/fixtures/setup-content-type.php`

- [ ] **Step 1: Write the drush php:script**

```php
<?php
// tests/integrations/drupal/fixtures/setup-content-type.php
//
// Creates content type "article_test" with:
//   - body (via node_add_body_field)
//   - field_test_text (string)  — used by create/update tests
//   - field_image    (image)    — used by upload-file tests
//
// Idempotent: safe to run on an existing site.

use Drupal\node\Entity\NodeType;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\field\Entity\FieldConfig;

$bundle = 'article_test';

$type = NodeType::load($bundle);
if (!$type) {
  $type = NodeType::create(['type' => $bundle, 'name' => 'Article Test']);
  $type->save();
  node_add_body_field($type);
  echo "Created content type $bundle\n";
} else {
  echo "Content type $bundle already exists\n";
}

function ensure_field(string $entity_type, string $bundle, string $field_name, string $type, array $config_overrides = []): void {
  if (!FieldStorageConfig::loadByName($entity_type, $field_name)) {
    FieldStorageConfig::create([
      'field_name'  => $field_name,
      'entity_type' => $entity_type,
      'type'        => $type,
    ])->save();
    echo "Created field storage $field_name\n";
  }
  if (!FieldConfig::loadByName($entity_type, $bundle, $field_name)) {
    FieldConfig::create(array_merge([
      'field_name'  => $field_name,
      'entity_type' => $entity_type,
      'bundle'      => $bundle,
      'label'       => $field_name,
    ], $config_overrides))->save();
    echo "Created field $field_name on $bundle\n";
  }
}

ensure_field('node', $bundle, 'field_test_text', 'string', ['label' => 'Test Text']);
ensure_field('node', $bundle, 'field_image',     'image',  ['label' => 'Image']);

echo "Content type setup complete\n";
```

- [ ] **Step 2: Commit**

```bash
git add tests/integrations/drupal/fixtures/setup-content-type.php
git commit -m "chore(fixture): drush script to create article_test content type

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Fixture script — OAuth2 consumers

Creates two separate simple_oauth Consumers (password grant + client_credentials grant) and prints their credentials so the orchestration script can capture them into `.test-config.json`.

**Files:**
- Create: `tests/integrations/drupal/fixtures/setup-oauth.php`

- [ ] **Step 1: Write the drush php:script**

```php
<?php
// tests/integrations/drupal/fixtures/setup-oauth.php
//
// Creates / updates two simple_oauth Consumers:
//   - password grant consumer  (client_id = tests-password)
//   - client_credentials grant consumer (client_id = tests-cc)
// Looked up idempotently by client_id.
// Prints a single JSON line beginning with "CONSUMER_JSON:" that the
// orchestration script greps for.

use Drupal\consumers\Entity\Consumer;

function ensure_consumer(string $client_id, string $label, array $grants, string $secret): string {
  $storage  = \Drupal::entityTypeManager()->getStorage('consumer');
  $existing = $storage->loadByProperties(['client_id' => $client_id]);
  $consumer = $existing ? reset($existing) : NULL;

  $values = [
    'label'        => $label,
    'client_id'    => $client_id,
    'secret'       => $secret,
    'confidential' => TRUE,
    'grant_types'  => $grants,
  ];

  if ($consumer) {
    foreach ($values as $k => $v) {
      $consumer->set($k, $v);
    }
    $consumer->save();
    echo "Updated consumer $label\n";
  } else {
    $consumer = Consumer::create($values);
    $consumer->save();
    echo "Created consumer $label\n";
  }
  return $consumer->get('client_id')->value;
}

$password_secret = bin2hex(random_bytes(16));
$cc_secret       = bin2hex(random_bytes(16));

$password_id = ensure_consumer(
  'tests-password',
  'Integration Test (password grant)',
  ['password'],
  $password_secret,
);

$cc_id = ensure_consumer(
  'tests-cc',
  'Integration Test (client_credentials grant)',
  ['client_credentials'],
  $cc_secret,
);

echo "CONSUMER_JSON:" . json_encode([
  'password_client_id'     => $password_id,
  'password_client_secret' => $password_secret,
  'cc_client_id'           => $cc_id,
  'cc_client_secret'       => $cc_secret,
]) . "\n";
```

> **Note on secrets:** Every invocation rotates secrets. That is fine — the orchestration script captures them into `.test-config.json` in the same run.

- [ ] **Step 2: Commit**

```bash
git add tests/integrations/drupal/fixtures/setup-oauth.php
git commit -m "chore(fixture): drush script to create simple_oauth Consumers

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Fixture script — test user

Creates a non-admin user `tester` with permission to create, edit, and delete `article_test` nodes (used by basic auth and OAuth2 password grant).

**Files:**
- Create: `tests/integrations/drupal/fixtures/setup-users.php`

- [ ] **Step 1: Write the drush php:script**

```php
<?php
// tests/integrations/drupal/fixtures/setup-users.php
//
// Creates a role "integration_editor" with CRUD permissions on
// article_test, and a user "tester" with password "tester-pw" in that role.

use Drupal\user\Entity\Role;
use Drupal\user\Entity\User;

$role_id = 'integration_editor';
$role = Role::load($role_id);
if (!$role) {
  $role = Role::create(['id' => $role_id, 'label' => 'Integration Editor']);
  $role->save();
  echo "Created role $role_id\n";
}

$perms = [
  'access content',
  'create article_test content',
  'edit any article_test content',
  'delete any article_test content',
  // Required for JSON:API writes against Drupal 11.
  'access jsonapi resource list',
];
foreach ($perms as $p) {
  if (!$role->hasPermission($p)) {
    $role->grantPermission($p);
  }
}
$role->save();

$username = 'tester';
$password = 'tester-pw';

$existing = \Drupal::entityTypeManager()->getStorage('user')->loadByProperties(['name' => $username]);
$user = $existing ? reset($existing) : NULL;
if (!$user) {
  $user = User::create([
    'name'   => $username,
    'pass'   => $password,
    'mail'   => 'tester@example.com',
    'status' => 1,
  ]);
  $user->addRole($role_id);
  $user->save();
  echo "Created user $username\n";
} else {
  $user->setPassword($password);
  if (!in_array($role_id, $user->getRoles(), TRUE)) $user->addRole($role_id);
  $user->save();
  echo "Updated user $username\n";
}

echo "User setup complete\n";
```

- [ ] **Step 2: Commit**

```bash
git add tests/integrations/drupal/fixtures/setup-users.php
git commit -m "chore(fixture): drush script for integration_editor role + tester user

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Orchestration — `drupal-up.sh`

Entry point for `npm run drupal:up`. Brings DDEV up, installs Drupal, runs all three fixture scripts, writes `.test-config.json`.

**Files:**
- Create: `tests/integrations/bin/drupal-up.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# tests/integrations/bin/drupal-up.sh
#
# Provisions the integration-test Drupal instance.
# Writes tests/integrations/drupal/.test-config.json on success.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRUPAL_DIR="$ROOT/tests/integrations/drupal"
cd "$DRUPAL_DIR"

# 1. Worktree-unique project name → no port collisions across worktrees.
HASH="$(pwd | sha1sum | cut -c1-8)"
PROJECT_NAME="drupal-cli-test-${HASH}"
mkdir -p .ddev
cat > .ddev/config.local.yaml <<EOF
name: ${PROJECT_NAME}
EOF

# 2. Start + composer install.
ddev start
ddev composer install --no-interaction

# 3. Fresh site install each run (idempotent, append-only within a run).
ddev drush site:install standard -y \
  --account-name=admin --account-pass=admin \
  --site-name="drupal-cli integration"

ddev drush en -y basic_auth jsonapi simple_oauth

# 4. simple_oauth RSA keypair.
KEYDIR=/var/www/html/keys
ddev exec "mkdir -p $KEYDIR && \
           openssl genrsa -out $KEYDIR/private.key 2048 && \
           openssl rsa -in $KEYDIR/private.key -pubout -out $KEYDIR/public.key && \
           chmod 600 $KEYDIR/private.key $KEYDIR/public.key"
ddev drush config:set -y simple_oauth.settings public_key "$KEYDIR/public.key"
ddev drush config:set -y simple_oauth.settings private_key "$KEYDIR/private.key"

# 5. Fixtures.
ddev drush php:script fixtures/setup-content-type.php
OAUTH_OUTPUT="$(ddev drush php:script fixtures/setup-oauth.php)"
ddev drush php:script fixtures/setup-users.php

# 6. Extract Consumer credentials from setup-oauth.php output.
OAUTH_JSON="$(echo "$OAUTH_OUTPUT" | grep '^CONSUMER_JSON:' | head -1 | sed 's/^CONSUMER_JSON://')"
if [ -z "$OAUTH_JSON" ]; then
  echo "ERROR: setup-oauth.php did not print CONSUMER_JSON line" >&2
  exit 1
fi

# 7. Capture URL.
URL="$(ddev describe -j | python3 -c 'import json,sys; print(json.load(sys.stdin)["raw"]["primary_url"])')"

# 8. Handover file.
cat > .test-config.json <<EOF
{
  "url": "${URL}",
  "basic":  { "user": "tester", "pass": "tester-pw" },
  "oauth2": $(echo "$OAUTH_JSON" | python3 -c '
import json, sys
d = json.load(sys.stdin)
d["user"] = "tester"
d["pass"] = "tester-pw"
print(json.dumps(d, indent=2))
')
}
EOF

echo
echo "✓ Drupal is up at $URL"
echo "✓ Handover written to tests/integrations/drupal/.test-config.json"
echo "  Run: npm run test:integration"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x tests/integrations/bin/drupal-up.sh
```

- [ ] **Step 3: Commit**

```bash
git add tests/integrations/bin/drupal-up.sh
git commit -m "feat(integrations): drupal-up.sh provisioning script

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Orchestration — `drupal-down.sh`

**Files:**
- Create: `tests/integrations/bin/drupal-down.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# tests/integrations/bin/drupal-down.sh
#
# Tears down the integration-test Drupal instance.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRUPAL_DIR="$ROOT/tests/integrations/drupal"
cd "$DRUPAL_DIR"

# Only attempt stop if we have a project name (i.e., drupal-up ran).
if [ -f .ddev/config.local.yaml ]; then
  ddev stop --unlist --remove-data --omit-snapshot || true
fi
rm -f .test-config.json .ddev/config.local.yaml
echo "✓ Drupal stopped and removed"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x tests/integrations/bin/drupal-down.sh
```

- [ ] **Step 3: Commit**

```bash
git add tests/integrations/bin/drupal-down.sh
git commit -m "feat(integrations): drupal-down.sh teardown script

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: `package.json` scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add three entries to the `scripts` block**

Replace the `scripts` block in `package.json` with:

```json
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest",
    "test:integration": "vitest run -c vitest.config.integration.ts",
    "typecheck": "tsc --noEmit",
    "drupal:up": "bash tests/integrations/bin/drupal-up.sh",
    "drupal:down": "bash tests/integrations/bin/drupal-down.sh"
  },
```

- [ ] **Step 2: Verify JSON validity + commit**

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8'))"
git add package.json
git commit -m "chore(scripts): add drupal:up / drupal:down / test:integration

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: Vitest integration config

**Files:**
- Create: `vitest.config.integration.ts`

- [ ] **Step 1: Write the config**

```ts
// vitest.config.integration.ts
// Separate config so the default `npm test` never runs integration tests.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integrations/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Single-threaded, serial — all tests share one Drupal instance.
    sequence: { concurrent: false },
    fileParallelism: false,
  },
});
```

- [ ] **Step 2: Verify it loads + commit**

```bash
npx tsc --noEmit vitest.config.integration.ts
git add vitest.config.integration.ts
git commit -m "chore(vitest): integration-test config (serial, long timeout)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: Test helper — `config.ts`

**Files:**
- Create: `tests/integrations/helpers/config.ts`

- [ ] **Step 1: Write the helper**

```ts
// tests/integrations/helpers/config.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface TestConfig {
  url: string;
  basic: { user: string; pass: string };
  oauth2: {
    password_client_id: string;
    password_client_secret: string;
    cc_client_id: string;
    cc_client_secret: string;
    user: string;
    pass: string;
  };
}

export function testConfig(): TestConfig {
  const path = resolve("tests/integrations/drupal/.test-config.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TestConfig;
  } catch {
    throw new Error(
      "Integration tests require a running DDEV. Run: npm run drupal:up",
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/integrations/helpers/config.ts
git commit -m "feat(integrations): helpers/config.ts — read .test-config.json

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 13: Test helper — `run.ts`

Subprocess runner + auth helpers + `createTestNode` utility.

**Files:**
- Create: `tests/integrations/helpers/run.ts`

- [ ] **Step 1: Write the helper**

```ts
// tests/integrations/helpers/run.ts
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testConfig } from "./config.js";

export type Auth =
  | { type: "basic"; user: string; pass: string }
  | {
      type: "oauth2_password";
      clientId: string;
      clientSecret: string;
      user: string;
      pass: string;
    }
  | {
      type: "oauth2_client_credentials";
      clientId: string;
      clientSecret: string;
    };

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  url?: string;         // defaults to testConfig().url
  auth?: Auth;          // defaults to basicAuth()
  args: string[];
}

function renderConfig(url: string, auth: Auth): string {
  const lines = [
    "site:",
    `  base_url: ${url}`,
    "  jsonapi_prefix: /jsonapi",
    "  auth:",
  ];
  if (auth.type === "basic") {
    lines.push(
      `    type: basic`,
      `    username: ${auth.user}`,
      `    password: ${auth.pass}`,
    );
  } else if (auth.type === "oauth2_password") {
    lines.push(
      `    type: oauth2_password`,
      `    client_id: ${auth.clientId}`,
      `    client_secret: ${auth.clientSecret}`,
      `    username: ${auth.user}`,
      `    password: ${auth.pass}`,
    );
  } else {
    lines.push(
      `    type: oauth2_client_credentials`,
      `    client_id: ${auth.clientId}`,
      `    client_secret: ${auth.clientSecret}`,
    );
  }
  lines.push("defaults:", "  dry_run: false", "  timeout_ms: 30000");
  return lines.join("\n") + "\n";
}

export async function runCli(opts: RunOptions): Promise<RunResult> {
  const cfg = testConfig();
  const url = opts.url ?? cfg.url;
  const auth = opts.auth ?? basicAuth();

  const dir = mkdtempSync(join(tmpdir(), "drupal-cli-it-"));
  const cfgPath = join(dir, ".drupal-cli.yml");
  writeFileSync(cfgPath, renderConfig(url, auth), "utf8");

  return await new Promise<RunResult>((resolve) => {
    const child = spawn("node", ["bin/drupal-cli", ...opts.args], {
      env: { ...process.env, DRUPAL_CLI_CONFIG: cfgPath },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += String(c)));
    child.stderr.on("data", (c) => (stderr += String(c)));
    child.on("close", (code) =>
      resolve({ code: code ?? -1, stdout, stderr }),
    );
  });
}

export function parseJson(stdout: string): unknown {
  return JSON.parse(stdout);
}

export function basicAuth(): Auth {
  const c = testConfig();
  return { type: "basic", user: c.basic.user, pass: c.basic.pass };
}

export function oauth2Password(): Auth {
  const c = testConfig();
  return {
    type: "oauth2_password",
    clientId: c.oauth2.password_client_id,
    clientSecret: c.oauth2.password_client_secret,
    user: c.oauth2.user,
    pass: c.oauth2.pass,
  };
}

export function oauth2ClientCred(): Auth {
  const c = testConfig();
  return {
    type: "oauth2_client_credentials",
    clientId: c.oauth2.cc_client_id,
    clientSecret: c.oauth2.cc_client_secret,
  };
}

export async function createTestNode(title: string): Promise<string> {
  const data = {
    data: {
      type: "node--article_test",
      attributes: { title },
    },
  };
  const r = await runCli({
    args: [
      "create",
      "node",
      "--bundle=article_test",
      `--data=${JSON.stringify(data)}`,
    ],
  });
  if (r.code !== 0) {
    throw new Error(
      `createTestNode failed: exit=${r.code} stderr=${r.stderr}`,
    );
  }
  const parsed = parseJson(r.stdout) as { data: { id: string } };
  return parsed.data.id;
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add tests/integrations/helpers/run.ts
git commit -m "feat(integrations): helpers/run.ts — CLI subprocess runner

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 14: Dummy PNG fixture

A minimal valid PNG for the `upload-file` test. The byte sequence below is a 1×1 transparent PNG (67 bytes).

**Files:**
- Create: `tests/integrations/fixtures/hero.png`

- [ ] **Step 1: Create the PNG**

```bash
mkdir -p tests/integrations/fixtures
node -e '
const fs = require("fs");
const bytes = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c636000000000050001a5f645400000000049454e44ae426082",
  "hex"
);
fs.writeFileSync("tests/integrations/fixtures/hero.png", bytes);
'
file tests/integrations/fixtures/hero.png
```

Expected output of `file`: `PNG image data, 1 x 1, 8-bit/color RGBA, non-interlaced`.

- [ ] **Step 2: Commit**

```bash
git add tests/integrations/fixtures/hero.png
git commit -m "chore(integrations): 1x1 PNG fixture for upload-file tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 15: `read.test.ts`

**Files:**
- Create: `tests/integrations/read.test.ts`

**Prerequisite:** `npm run drupal:up` has been run on the host.

- [ ] **Step 1: Write the tests**

```ts
// tests/integrations/read.test.ts
import { describe, expect, it } from "vitest";
import { createTestNode, parseJson, runCli } from "./helpers/run.js";

describe("integration: read", () => {
  it("reads an existing node", async () => {
    const title = `it-read-${crypto.randomUUID()}`;
    const uuid = await createTestNode(title);

    const r = await runCli({ args: ["read", `node/article_test/${uuid}`] });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    const body = parseJson(r.stdout) as { data: { id: string; attributes: { title: string } } };
    expect(body.data.id).toBe(uuid);
    expect(body.data.attributes.title).toBe(title);
  });

  it("returns exit 5 for an unknown UUID", async () => {
    const bogus = "00000000-0000-0000-0000-000000000000";
    const r = await runCli({ args: ["read", `node/article_test/${bogus}`] });
    expect(r.code).toBe(5);
    expect(r.stderr.length).toBeGreaterThan(0);
    const err = JSON.parse(r.stderr) as { code: string };
    expect(err.code).toBe("E_HTTP");
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npm run test:integration -- tests/integrations/read.test.ts
```

Expected: 2/2 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/integrations/read.test.ts
git commit -m "test(integrations): read command

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 16: `search.test.ts`

**Files:**
- Create: `tests/integrations/search.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// tests/integrations/search.test.ts
import { describe, expect, it } from "vitest";
import { createTestNode, parseJson, runCli } from "./helpers/run.js";

type SearchResponse = { data: Array<{ id: string; attributes: { title: string } }> };

describe("integration: search", () => {
  it("returns up to --limit results", async () => {
    // Ensure at least 2 exist.
    await createTestNode(`it-search-setup-${crypto.randomUUID()}`);
    await createTestNode(`it-search-setup-${crypto.randomUUID()}`);

    const r = await runCli({
      args: ["search", "node", "--bundle=article_test", "--limit=5"],
    });
    expect(r.code).toBe(0);
    const body = parseJson(r.stdout) as SearchResponse;
    expect(body.data.length).toBeLessThanOrEqual(5);
  });

  it("filters by exact title", async () => {
    const title = `it-search-exact-${crypto.randomUUID()}`;
    const uuid = await createTestNode(title);

    const r = await runCli({
      args: [
        "search",
        "node",
        "--bundle=article_test",
        `--filter=title:${title}`,
      ],
    });
    expect(r.code).toBe(0);
    const body = parseJson(r.stdout) as SearchResponse;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.id).toBe(uuid);
  });

  it("filters by status operator", async () => {
    await createTestNode(`it-search-status-${crypto.randomUUID()}`);

    const r = await runCli({
      args: [
        "search",
        "node",
        "--bundle=article_test",
        "--filter=status:=:1",
        "--limit=2",
      ],
    });
    expect(r.code).toBe(0);
    const body = parseJson(r.stdout) as SearchResponse & {
      data: Array<{ attributes: { status: boolean } }>;
    };
    for (const item of body.data) {
      expect(item.attributes.status).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
npm run test:integration -- tests/integrations/search.test.ts
git add tests/integrations/search.test.ts
git commit -m "test(integrations): search command

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 17: `create.test.ts`

**Files:**
- Create: `tests/integrations/create.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// tests/integrations/create.test.ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson, runCli } from "./helpers/run.js";

type SearchResponse = { data: Array<{ id: string }> };

function payload(title: string): string {
  return JSON.stringify({
    data: { type: "node--article_test", attributes: { title } },
  });
}

async function searchByTitle(title: string): Promise<string[]> {
  const r = await runCli({
    args: ["search", "node", "--bundle=article_test", `--filter=title:${title}`],
  });
  const body = parseJson(r.stdout) as SearchResponse;
  return body.data.map((d) => d.id);
}

describe("integration: create", () => {
  it("creates a node and returns its UUID", async () => {
    const title = `it-create-${crypto.randomUUID()}`;
    const r = await runCli({
      args: [
        "create",
        "node",
        "--bundle=article_test",
        `--data=${payload(title)}`,
      ],
    });
    expect(r.code).toBe(0);
    const body = parseJson(r.stdout) as { data: { id: string } };
    expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/);

    const hits = await searchByTitle(title);
    expect(hits).toHaveLength(1);
  });

  it("--dry-run does not write", async () => {
    const title = `it-create-dryrun-${crypto.randomUUID()}`;
    const r = await runCli({
      args: [
        "create",
        "node",
        "--bundle=article_test",
        `--data=${payload(title)}`,
        "--dry-run",
      ],
    });
    expect(r.code).toBe(0);

    const hits = await searchByTitle(title);
    expect(hits).toHaveLength(0);
  });

  it("--data=@file works the same as inline", async () => {
    const title = `it-create-file-${crypto.randomUUID()}`;
    const dir = mkdtempSync(join(tmpdir(), "drupal-cli-data-"));
    const path = join(dir, "data.json");
    writeFileSync(path, payload(title), "utf8");

    const r = await runCli({
      args: [
        "create",
        "node",
        "--bundle=article_test",
        `--data=@${path}`,
      ],
    });
    expect(r.code).toBe(0);

    const hits = await searchByTitle(title);
    expect(hits).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
npm run test:integration -- tests/integrations/create.test.ts
git add tests/integrations/create.test.ts
git commit -m "test(integrations): create command (inline, --dry-run, @file)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 18: `update.test.ts`

**Files:**
- Create: `tests/integrations/update.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// tests/integrations/update.test.ts
import { describe, expect, it } from "vitest";
import { createTestNode, parseJson, runCli } from "./helpers/run.js";

type NodeBody = { data: { id: string; attributes: { title: string } } };

async function readTitle(uuid: string): Promise<string> {
  const r = await runCli({ args: ["read", `node/article_test/${uuid}`] });
  return (parseJson(r.stdout) as NodeBody).data.attributes.title;
}

function patchPayload(newTitle: string, uuid: string): string {
  return JSON.stringify({
    data: {
      type: "node--article_test",
      id: uuid,
      attributes: { title: newTitle },
    },
  });
}

describe("integration: update", () => {
  it("updates a node's title", async () => {
    const original = `it-update-orig-${crypto.randomUUID()}`;
    const updated = `it-update-new-${crypto.randomUUID()}`;
    const uuid = await createTestNode(original);

    const r = await runCli({
      args: [
        "update",
        `node/article_test/${uuid}`,
        `--data=${patchPayload(updated, uuid)}`,
      ],
    });
    expect(r.code).toBe(0);
    expect(await readTitle(uuid)).toBe(updated);
  });

  it("--dry-run does not mutate", async () => {
    const original = `it-update-dryrun-${crypto.randomUUID()}`;
    const dryRun  = `it-update-dryrun-NEW-${crypto.randomUUID()}`;
    const uuid = await createTestNode(original);

    const r = await runCli({
      args: [
        "update",
        `node/article_test/${uuid}`,
        `--data=${patchPayload(dryRun, uuid)}`,
        "--dry-run",
      ],
    });
    expect(r.code).toBe(0);
    expect(await readTitle(uuid)).toBe(original);
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
npm run test:integration -- tests/integrations/update.test.ts
git add tests/integrations/update.test.ts
git commit -m "test(integrations): update command

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 19: `delete.test.ts`

**Files:**
- Create: `tests/integrations/delete.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// tests/integrations/delete.test.ts
import { describe, expect, it } from "vitest";
import { createTestNode, runCli } from "./helpers/run.js";

describe("integration: delete", () => {
  it("deletes a node and the subsequent read returns 404", async () => {
    const uuid = await createTestNode(`it-delete-${crypto.randomUUID()}`);

    const del = await runCli({ args: ["delete", `node/article_test/${uuid}`] });
    expect(del.code).toBe(0);

    const read = await runCli({ args: ["read", `node/article_test/${uuid}`] });
    expect(read.code).toBe(5);
  });

  it("--dry-run leaves the node intact", async () => {
    const uuid = await createTestNode(`it-delete-dryrun-${crypto.randomUUID()}`);

    const del = await runCli({
      args: ["delete", `node/article_test/${uuid}`, "--dry-run"],
    });
    expect(del.code).toBe(0);

    const read = await runCli({ args: ["read", `node/article_test/${uuid}`] });
    expect(read.code).toBe(0);
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
npm run test:integration -- tests/integrations/delete.test.ts
git add tests/integrations/delete.test.ts
git commit -m "test(integrations): delete command

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 20: `upload-file.test.ts`

**Files:**
- Create: `tests/integrations/upload-file.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// tests/integrations/upload-file.test.ts
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createTestNode, parseJson, runCli } from "./helpers/run.js";

const PNG = resolve("tests/integrations/fixtures/hero.png");

describe("integration: upload-file", () => {
  it("uploads a PNG to field_image and attaches it", async () => {
    const uuid = await createTestNode(`it-upload-${crypto.randomUUID()}`);

    const up = await runCli({
      args: [
        "upload-file",
        `--target=node/article_test/${uuid}/field_image`,
        `--file=${PNG}`,
      ],
    });
    expect(up.code).toBe(0);

    const fileResp = parseJson(up.stdout) as { data: { id: string } };
    expect(fileResp.data.id).toMatch(/^[0-9a-f-]{36}$/);

    // Verify the node now references the uploaded file via field_image.
    const read = await runCli({ args: ["read", `node/article_test/${uuid}`] });
    expect(read.code).toBe(0);
    const node = parseJson(read.stdout) as {
      data: { relationships?: { field_image?: { data: { id: string } } } };
    };
    expect(node.data.relationships?.field_image?.data?.id).toBe(fileResp.data.id);
  });

  it("returns exit 4 when --file does not exist", async () => {
    const uuid = await createTestNode(`it-upload-missing-${crypto.randomUUID()}`);

    const r = await runCli({
      args: [
        "upload-file",
        `--target=node/article_test/${uuid}/field_image`,
        "--file=/nonexistent/does-not-exist.png",
      ],
    });
    expect(r.code).toBe(4);
    const err = JSON.parse(r.stderr) as { code: string };
    expect(err.code).toBe("E_VALIDATION");
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
npm run test:integration -- tests/integrations/upload-file.test.ts
git add tests/integrations/upload-file.test.ts
git commit -m "test(integrations): upload-file command

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 21: `auth-basic.test.ts`

Only needs a negative test — happy path is covered by all prior command tests, which default to basic auth.

**Files:**
- Create: `tests/integrations/auth-basic.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/integrations/auth-basic.test.ts
import { describe, expect, it } from "vitest";
import { runCli, type Auth } from "./helpers/run.js";
import { testConfig } from "./helpers/config.js";

describe("integration: auth basic", () => {
  it("returns exit 5 with wrong password", async () => {
    const c = testConfig();
    const badAuth: Auth = { type: "basic", user: c.basic.user, pass: "wrong-password" };
    // Use a harmless command; any authenticated request will surface the error.
    const r = await runCli({
      auth: badAuth,
      args: ["search", "node", "--bundle=article_test", "--limit=1"],
    });
    // Drupal returns 401/403 → HttpError → exit 5.
    expect(r.code).toBe(5);
    const err = JSON.parse(r.stderr) as { code: string };
    expect(err.code).toBe("E_HTTP");
  });
});
```

> **Note:** Basic-auth failures surface as `HttpError` (Drupal returns 401/403), not `AuthError`. `AuthError` (exit 3) is reserved for client-side auth-adapter problems like OAuth2 token-endpoint failures.

- [ ] **Step 2: Run + commit**

```bash
npm run test:integration -- tests/integrations/auth-basic.test.ts
git add tests/integrations/auth-basic.test.ts
git commit -m "test(integrations): auth-basic smoke test

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 22: `auth-oauth2-password.test.ts`

**Files:**
- Create: `tests/integrations/auth-oauth2-password.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// tests/integrations/auth-oauth2-password.test.ts
import { describe, expect, it } from "vitest";
import { createTestNode, oauth2Password, parseJson, runCli, type Auth } from "./helpers/run.js";
import { testConfig } from "./helpers/config.js";

describe("integration: auth oauth2 password grant", () => {
  it("reads a node using a password-grant token", async () => {
    // createTestNode uses basic auth — that's fine, we just need an entity to read.
    const uuid = await createTestNode(`it-auth-oauth2pw-${crypto.randomUUID()}`);

    const r = await runCli({
      auth: oauth2Password(),
      args: ["read", `node/article_test/${uuid}`],
    });
    expect(r.code).toBe(0);
    const body = parseJson(r.stdout) as { data: { id: string } };
    expect(body.data.id).toBe(uuid);
  });

  it("returns exit 3 with a wrong password", async () => {
    const c = testConfig();
    const badAuth: Auth = {
      type: "oauth2_password",
      clientId: c.oauth2.password_client_id,
      clientSecret: c.oauth2.password_client_secret,
      user: c.oauth2.user,
      pass: "wrong-password",
    };
    const r = await runCli({
      auth: badAuth,
      args: ["search", "node", "--bundle=article_test", "--limit=1"],
    });
    // Token endpoint rejects → OAuth2 adapter raises AuthError → exit 3.
    expect(r.code).toBe(3);
    const err = JSON.parse(r.stderr) as { code: string };
    expect(err.code).toBe("E_AUTH");
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
npm run test:integration -- tests/integrations/auth-oauth2-password.test.ts
git add tests/integrations/auth-oauth2-password.test.ts
git commit -m "test(integrations): auth oauth2_password

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 23: `auth-oauth2-client-credentials.test.ts`

**Files:**
- Create: `tests/integrations/auth-oauth2-client-credentials.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// tests/integrations/auth-oauth2-client-credentials.test.ts
import { describe, expect, it } from "vitest";
import {
  createTestNode,
  oauth2ClientCred,
  parseJson,
  runCli,
  type Auth,
} from "./helpers/run.js";
import { testConfig } from "./helpers/config.js";

describe("integration: auth oauth2 client_credentials grant", () => {
  it("reads a node using a client-credentials token", async () => {
    const uuid = await createTestNode(`it-auth-oauth2cc-${crypto.randomUUID()}`);

    const r = await runCli({
      auth: oauth2ClientCred(),
      args: ["read", `node/article_test/${uuid}`],
    });
    expect(r.code).toBe(0);
    const body = parseJson(r.stdout) as { data: { id: string } };
    expect(body.data.id).toBe(uuid);
  });

  it("returns exit 3 with a wrong client_secret", async () => {
    const c = testConfig();
    const badAuth: Auth = {
      type: "oauth2_client_credentials",
      clientId: c.oauth2.cc_client_id,
      clientSecret: "wrong-secret",
    };
    const r = await runCli({
      auth: badAuth,
      args: ["search", "node", "--bundle=article_test", "--limit=1"],
    });
    expect(r.code).toBe(3);
    const err = JSON.parse(r.stderr) as { code: string };
    expect(err.code).toBe("E_AUTH");
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
npm run test:integration -- tests/integrations/auth-oauth2-client-credentials.test.ts
git add tests/integrations/auth-oauth2-client-credentials.test.ts
git commit -m "test(integrations): auth oauth2_client_credentials

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 24: Run the full integration suite

All tests together — serial, single file of shared Drupal state.

- [ ] **Step 1: Run the whole suite**

```bash
npm run test:integration
```

Expected: all tests from Tasks 15–23 pass in a single run (serial execution, ~30–60 s total).

- [ ] **Step 2: If any test fails, fix it and re-commit**

Failures at this point are most likely test ordering (a test assumes setup another test did) or an implicit assumption about empty Drupal state. Read the failing test + the tests run before it, fix the specific test, re-run the full suite.

Commit each fix as a separate small commit.

---

## Task 25: README for `tests/integrations/`

**Files:**
- Create: `tests/integrations/README.md`

- [ ] **Step 1: Write the README**

```markdown
# Integration Tests

Real Drupal 11 over DDEV. Local-only, not run in CI.

## Prerequisites

- DDEV installed locally — https://ddev.com/
- Docker running
- `node >= 20`

## Running

```bash
npm run drupal:up          # start DDEV, provision fixtures (~2 min first run)
npm run test:integration   # run the suite (~30–60 s)
npm run drupal:down        # stop & delete the DDEV project
```

## How it works

`drupal:up` provisions a fresh Drupal 11 site inside DDEV, enables
`basic_auth`, `jsonapi`, and `simple_oauth`, creates a dedicated
`article_test` content type, creates two OAuth2 consumers (password +
client_credentials grants), and writes live URL + credentials to
`tests/integrations/drupal/.test-config.json`.

Each test spawns `node bin/drupal-cli` as a subprocess with a temp
`.drupal-cli.yml` pointing at that URL, then asserts on exit code,
stdout JSON, and stderr.

## Troubleshooting

- **"Integration tests require a running DDEV"** — you forgot
  `npm run drupal:up`.
- **DDEV port conflicts across worktrees** — each worktree gets its
  own project name (hashed from pwd). If one worktree is already
  running, another will start with a different name and different
  ports automatically.
- **Want to poke around the running site?** From
  `tests/integrations/drupal/`: `ddev describe` shows the URL,
  admin login is `admin / admin`. Non-admin test user is
  `tester / tester-pw`.
- **Tests fail with stale state** — `npm run drupal:down`,
  then `npm run drupal:up` again. Each run is a fresh Drupal install.
```

- [ ] **Step 2: Commit**

```bash
git add tests/integrations/README.md
git commit -m "docs(integrations): README with prerequisites and troubleshooting

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 26: Update repo-root `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Extend the Development block**

Replace the Development block (lines 41–49) of `README.md` with:

```markdown
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
npm run drupal:up          # Start integration-test Drupal (DDEV)
npm run test:integration   # Run integration tests
npm run drupal:down        # Stop DDEV
```

See `docs/superpowers/specs/2026-04-21-drupal-cli-design.md` for the full design.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): point at integration-test scripts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
