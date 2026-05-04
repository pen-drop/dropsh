# Single Schemata Fixture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate integration tests to a single DDEV fixture that always has the schemata module installed, removing the separate non-schemata fixture and all its scaffolding.

**Architecture:** The `drupal-schemata` fixture becomes the only integration fixture (renamed to `drupal`). Shell scripts, npm scripts, and test helpers collapse from two variants to one. Three heuristic-specific tests are rewritten to assert schemata-sourced output.

**Tech Stack:** Bash, TypeScript, Vitest, DDEV

---

## File Map

**Delete (tracked):**
- `tests/integrations/drupal/` — old non-schemata DDEV fixture (58 tracked files)
- `tests/integrations/bin/drupal-schemata-up.sh`
- `tests/integrations/bin/drupal-schemata-down.sh`
- `tests/integrations/schema/schema-heuristic.integration.test.ts`
- `tests/integrations/schema/schema-heuristic-empty-bundle.integration.test.ts`

**Rename:**
- `tests/integrations/drupal-schemata/` → `tests/integrations/drupal/`

**Modify:**
- `tests/integrations/bin/drupal-up.sh` — replace content with schemata version
- `tests/integrations/bin/drupal-down.sh` — replace content pointing at renamed dir
- `package.json` — remove `drupal-schemata:up` / `drupal-schemata:down`
- `tests/integrations/helpers/config.ts` — remove `testConfigSchemata()`
- `tests/integrations/helpers/run.ts` — remove `runCliSchemata()`, keep `runCli()` with `NODE_TLS_REJECT_UNAUTHORIZED: "0"`
- `tests/integrations/schema/schema-jsonschema-create.integration.test.ts` — `runCliSchemata` → `runCli`
- `tests/integrations/schema/schema-jsonschema-update.integration.test.ts` — `runCliSchemata` → `runCli`
- `tests/integrations/schema/schema-validates-create-payload.integration.test.ts` — `runCliSchemata` → `runCli`
- `tests/integrations/schema/schema-refresh.integration.test.ts` — remove heuristic stderr assertion
- `tests/integrations/README.md` — update docs

**Create:**
- `tests/integrations/schema/schema-source.integration.test.ts`
- `tests/integrations/schema/schema-empty-bundle.integration.test.ts`

---

### Task 1: Remove old fixture, rename drupal-schemata → drupal, update scripts

**Files:**
- Delete: `tests/integrations/drupal/` (entire directory)
- Rename: `tests/integrations/drupal-schemata/` → `tests/integrations/drupal/`
- Modify: `tests/integrations/bin/drupal-up.sh`
- Modify: `tests/integrations/bin/drupal-down.sh`
- Delete: `tests/integrations/bin/drupal-schemata-up.sh`
- Delete: `tests/integrations/bin/drupal-schemata-down.sh`
- Modify: `package.json`

- [ ] **Step 1: Remove the old non-schemata fixture from git and disk**

```bash
git rm -r tests/integrations/drupal/
rm -rf tests/integrations/drupal   # removes gitignored files (vendor/, .test-config.json, etc.)
```

- [ ] **Step 2: Rename drupal-schemata to drupal**

```bash
git mv tests/integrations/drupal-schemata tests/integrations/drupal
```

- [ ] **Step 3: Replace drupal-up.sh with schemata content**

Write `tests/integrations/bin/drupal-up.sh` with exactly this content:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRUPAL_DIR="$ROOT/tests/integrations/drupal"

cd "$DRUPAL_DIR"

HASH="$(pwd | sha1sum | cut -c1-8)"
PROJECT_NAME="drupal-cli-test-schemata-${HASH}"

mkdir -p .ddev
printf 'name: %s\n' "$PROJECT_NAME" > .ddev/config.local.yaml

ddev start
ddev composer install --no-interaction

ddev drush site:install standard -y \
  --account-name=admin --account-pass=admin \
  --site-name="drupal-cli integration (schemata)"

ddev drush en -y basic_auth jsonapi simple_oauth simple_oauth_password_grant consumers schemata schemata_json_schema
ddev drush php:eval "\Drupal::configFactory()->getEditable('jsonapi.settings')->set('read_only', FALSE)->save();"

KEYDIR="/var/www/html/keys"
ddev exec bash -lc "mkdir -p '$KEYDIR' && openssl genrsa -out '$KEYDIR/private.key' 2048 && openssl rsa -in '$KEYDIR/private.key' -pubout -out '$KEYDIR/public.key' && chmod 600 '$KEYDIR/private.key' '$KEYDIR/public.key'"
ddev drush config:set -y simple_oauth.settings public_key "$KEYDIR/public.key"
ddev drush config:set -y simple_oauth.settings private_key "$KEYDIR/private.key"

ddev drush php:script fixtures/setup-content-type.php
ddev drush php:script fixtures/setup-users.php
OAUTH_OUTPUT="$(ddev drush php:script fixtures/setup-oauth.php)"
OAUTH_JSON="$(printf '%s\n' "$OAUTH_OUTPUT" | grep '^CONSUMER_JSON:' | head -1 | sed 's/^CONSUMER_JSON://')"
if [ -z "$OAUTH_JSON" ]; then
  echo "ERROR: setup-oauth.php did not print CONSUMER_JSON line" >&2
  exit 1
fi

URL="$(ddev describe -j | python3 -c 'import json, sys; print(json.load(sys.stdin)["raw"]["services"]["web"]["http_url"])')"

cat > .test-config.json <<EOF
{
  "url": "${URL}",
  "basic": { "user": "tester", "pass": "tester-pw" },
  "oauth2": $(printf '%s' "$OAUTH_JSON" | python3 -c '
import json, sys
data = json.load(sys.stdin)
data["user"] = "tester"
data["pass"] = "tester-pw"
print(json.dumps(data, indent=2))
')
}
EOF

echo
echo "Drupal is up at ${URL}"
echo "Handover written to tests/integrations/drupal/.test-config.json"
echo "Run: npm run test:integration"
```

- [ ] **Step 4: Replace drupal-down.sh with content pointing at renamed dir**

Write `tests/integrations/bin/drupal-down.sh` with exactly this content:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRUPAL_DIR="$ROOT/tests/integrations/drupal"

cd "$DRUPAL_DIR"
ddev delete -Oy || true
rm -f .test-config.json .ddev/config.local.yaml
```

- [ ] **Step 5: Remove the schemata-specific scripts**

```bash
git rm tests/integrations/bin/drupal-schemata-up.sh
git rm tests/integrations/bin/drupal-schemata-down.sh
```

- [ ] **Step 6: Remove schemata npm scripts from package.json**

In `package.json`, remove these two lines from the `scripts` block:

```json
"drupal-schemata:up": "bash tests/integrations/bin/drupal-schemata-up.sh",
"drupal-schemata:down": "bash tests/integrations/bin/drupal-schemata-down.sh",
```

The remaining scripts block should look like:

```json
"scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest",
    "test:integration": "npm run build && vitest run -c vitest.config.integration.ts",
    "typecheck": "tsc --noEmit",
    "drupal:up": "bash tests/integrations/bin/drupal-up.sh",
    "drupal:down": "bash tests/integrations/bin/drupal-down.sh"
},
```

- [ ] **Step 7: Commit**

```bash
git add tests/integrations/bin/drupal-up.sh
git add tests/integrations/bin/drupal-down.sh
git add package.json
git commit -m "refactor(test): consolidate to single schemata DDEV fixture"
```

---

### Task 2: Simplify test helpers

**Files:**
- Modify: `tests/integrations/helpers/config.ts`
- Modify: `tests/integrations/helpers/run.ts`

- [ ] **Step 1: Remove testConfigSchemata from config.ts**

Replace the entire content of `tests/integrations/helpers/config.ts` with:

```typescript
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface TestConfig {
  url: string;
  basic: { user: string; pass: string };
  oauth2: {
    scope: string;
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
    throw new Error("Integration tests require a running DDEV. Run: npm run drupal:up");
  }
}
```

- [ ] **Step 2: Remove runCliSchemata from run.ts, keep runCli with NODE_TLS_REJECT_UNAUTHORIZED**

Replace the entire content of `tests/integrations/helpers/run.ts` with:

```typescript
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
      scope?: string;
    }
  | {
      type: "oauth2_client_credentials";
      clientId: string;
      clientSecret: string;
      scope?: string;
    };

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ErrorPayload {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

export interface RunOptions {
  url?: string;
  auth?: Auth;
  args: string[];
}

function renderConfig(url: string, auth: Auth): string {
  const lines = ["site:", `  base_url: ${url}`, "  jsonapi_prefix: /jsonapi", "  auth:"];
  if (auth.type === "basic") {
    lines.push("    type: basic", `    username: ${auth.user}`, `    password: ${auth.pass}`);
  } else if (auth.type === "oauth2_password") {
    lines.push(
      "    type: oauth2_password",
      `    client_id: ${auth.clientId}`,
      `    client_secret: ${auth.clientSecret}`,
      `    username: ${auth.user}`,
      `    password: ${auth.pass}`,
    );
    if (auth.scope) lines.push(`    scope: ${auth.scope}`);
  } else {
    lines.push(
      "    type: oauth2_client_credentials",
      `    client_id: ${auth.clientId}`,
      `    client_secret: ${auth.clientSecret}`,
    );
    if (auth.scope) lines.push(`    scope: ${auth.scope}`);
  }
  lines.push("defaults:", "  dry_run: false", "  timeout_ms: 30000");
  return `${lines.join("\n")}\n`;
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
      env: {
        ...process.env,
        DRUPAL_CLI_CONFIG: cfgPath,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export function parseJson<T = unknown>(stdout: string): T {
  return JSON.parse(stdout) as T;
}

export function parseError(stderr: string): ErrorPayload {
  return JSON.parse(stderr) as ErrorPayload;
}

export function basicAuth(): Auth {
  const cfg = testConfig();
  return { type: "basic", user: cfg.basic.user, pass: cfg.basic.pass };
}

export function oauth2Password(): Auth {
  const cfg = testConfig();
  return {
    type: "oauth2_password",
    clientId: cfg.oauth2.password_client_id,
    clientSecret: cfg.oauth2.password_client_secret,
    user: cfg.oauth2.user,
    pass: cfg.oauth2.pass,
    scope: cfg.oauth2.scope,
  };
}

export function oauth2ClientCred(): Auth {
  const cfg = testConfig();
  return {
    type: "oauth2_client_credentials",
    clientId: cfg.oauth2.cc_client_id,
    clientSecret: cfg.oauth2.cc_client_secret,
    scope: cfg.oauth2.scope,
  };
}

export async function createTestNode(title: string): Promise<string> {
  const payload = {
    data: {
      type: "node--article_test",
      attributes: { title },
    },
  };

  const result = await runCli({
    args: ["create", "node", "--bundle=article_test", `--data=${JSON.stringify(payload)}`],
  });
  if (result.code !== 0) {
    throw new Error(`createTestNode failed: exit=${result.code} stderr=${result.stderr}`);
  }

  const body = parseJson<{ data: { id: string } }>(result.stdout);
  return body.data.id;
}
```

- [ ] **Step 3: Verify the TypeScript build passes**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add tests/integrations/helpers/config.ts
git add tests/integrations/helpers/run.ts
git commit -m "refactor(test): remove testConfigSchemata and runCliSchemata helpers"
```

---

### Task 3: Update imports in schemata-specific tests

**Files:**
- Modify: `tests/integrations/schema/schema-jsonschema-create.integration.test.ts`
- Modify: `tests/integrations/schema/schema-jsonschema-update.integration.test.ts`
- Modify: `tests/integrations/schema/schema-validates-create-payload.integration.test.ts`

These three files import `runCliSchemata`. Change every occurrence to `runCli`.

- [ ] **Step 1: Update schema-jsonschema-create.integration.test.ts**

Change line:
```typescript
import { parseJson, runCliSchemata } from "../helpers/run.js";
```
to:
```typescript
import { parseJson, runCli } from "../helpers/run.js";
```

Then change the call site:
```typescript
const result = await runCliSchemata({ args: ["schema", "node/article_test", "--refresh"] });
```
to:
```typescript
const result = await runCli({ args: ["schema", "node/article_test", "--refresh"] });
```

- [ ] **Step 2: Update schema-jsonschema-update.integration.test.ts**

Change line:
```typescript
import { parseJson, runCliSchemata } from "../helpers/run.js";
```
to:
```typescript
import { parseJson, runCli } from "../helpers/run.js";
```

Then change the call site:
```typescript
const result = await runCliSchemata({ args: ["schema", "node/article_test", "--for=update", "--refresh"] });
```
to:
```typescript
const result = await runCli({ args: ["schema", "node/article_test", "--for=update", "--refresh"] });
```

- [ ] **Step 3: Update schema-validates-create-payload.integration.test.ts**

Change line:
```typescript
import { parseError, runCliSchemata } from "../helpers/run.js";
```
to:
```typescript
import { parseError, runCli } from "../helpers/run.js";
```

Then change both call sites (two `it` blocks):
```typescript
const result = await runCliSchemata({
```
to:
```typescript
const result = await runCli({
```

- [ ] **Step 4: Verify TypeScript build**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add tests/integrations/schema/schema-jsonschema-create.integration.test.ts
git add tests/integrations/schema/schema-jsonschema-update.integration.test.ts
git add tests/integrations/schema/schema-validates-create-payload.integration.test.ts
git commit -m "refactor(test): replace runCliSchemata with runCli in schema tests"
```

---

### Task 4: Adapt schema-refresh test and replace heuristic tests

**Files:**
- Modify: `tests/integrations/schema/schema-refresh.integration.test.ts`
- Delete: `tests/integrations/schema/schema-heuristic.integration.test.ts`
- Delete: `tests/integrations/schema/schema-heuristic-empty-bundle.integration.test.ts`
- Create: `tests/integrations/schema/schema-source.integration.test.ts`
- Create: `tests/integrations/schema/schema-empty-bundle.integration.test.ts`

- [ ] **Step 1: Update schema-refresh.integration.test.ts**

In `tests/integrations/schema/schema-refresh.integration.test.ts`, find the assertion on `third.stderr`:

```typescript
expect(third.stderr).toMatch(/no 'schemata' module/);
```

Replace it with:

```typescript
expect(third.stderr).toBe("");
```

- [ ] **Step 2: Delete heuristic test files**

```bash
git rm tests/integrations/schema/schema-heuristic.integration.test.ts
git rm tests/integrations/schema/schema-heuristic-empty-bundle.integration.test.ts
```

- [ ] **Step 3: Create schema-source.integration.test.ts**

Create `tests/integrations/schema/schema-source.integration.test.ts` with this content:

```typescript
import { describe, expect, it } from "vitest";
import { parseJson, runCli } from "../helpers/run.js";

describe("integration: schema source", () => {
  it("returns a schemata-sourced schema with no warning", async () => {
    const result = await runCli({ args: ["schema", "node/article_test", "--refresh"] });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const schema = parseJson<{ [k: string]: unknown }>(result.stdout);
    expect(schema["x-drupal-cli-source"]).toBe("schemata");
    expect(schema["x-drupal-cli-target"]).toEqual({ entity_type: "node", bundle: "article_test" });
    expect(schema["x-drupal-cli-operation"]).toBe("create");
  });
});
```

- [ ] **Step 4: Create schema-empty-bundle.integration.test.ts**

Create `tests/integrations/schema/schema-empty-bundle.integration.test.ts` with this content:

```typescript
import { describe, expect, it } from "vitest";
import { parseJson, runCli } from "../helpers/run.js";

describe("integration: schema empty bundle", () => {
  it("returns a schemata-sourced schema for a bundle with no instances", async () => {
    const result = await runCli({ args: ["schema", "taxonomy_term/tags", "--refresh"] });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const schema = parseJson<{ [k: string]: unknown }>(result.stdout);
    expect(schema["x-drupal-cli-source"]).toBe("schemata");
  });
});
```

- [ ] **Step 5: Verify TypeScript build**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add tests/integrations/schema/schema-refresh.integration.test.ts
git add tests/integrations/schema/schema-source.integration.test.ts
git add tests/integrations/schema/schema-empty-bundle.integration.test.ts
git commit -m "refactor(test): replace heuristic schema tests with schemata-sourced assertions"
```

---

### Task 5: Update README

**Files:**
- Modify: `tests/integrations/README.md`

- [ ] **Step 1: Rewrite README**

Replace the entire content of `tests/integrations/README.md` with:

```markdown
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

Each test spawns `node bin/drupal-cli` as a subprocess with a temporary `.drupal-cli.yml` pointing at that DDEV URL, then asserts on exit code, stdout JSON, and stderr. The subprocess runs with `NODE_TLS_REJECT_UNAUTHORIZED=0` so DDEV's self-signed HTTPS certificates are accepted without touching the host CA trust store.

## Troubleshooting

- "Integration tests require a running DDEV" means `npm run drupal:up` has not been run.
- If state gets stale, run `npm run drupal:down` and then `npm run drupal:up` again.
- From `tests/integrations/drupal/`, `ddev describe` shows the live URL. Admin login is `admin / admin`, test user is `tester / tester-pw`.
```

- [ ] **Step 2: Commit**

```bash
git add tests/integrations/README.md
git commit -m "docs(test): update integration README for single schemata fixture"
```
