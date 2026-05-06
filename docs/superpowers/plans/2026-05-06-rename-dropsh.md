# Rename drupal-cli → dropsh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename every occurrence of `drupal-cli` / `DRUPAL_CLI` / `@drupal-cli` across the codebase to `dropsh` / `DROPSH` / `@dropsh`, and push the result to the new repository `git@github.com:pen-drop/dropsh.git`.

**Architecture:** Pure rename — no logic changes. Work on a new local branch `dropsh`. Each task targets one cohesive area (bin, source, plugins, tests, docs), commits it independently, and verifies the build stays green before the final push.

**Tech Stack:** Node.js 20+, TypeScript, Vitest, Biome, npm workspaces (pnpm)

---

### Task 1: Create branch and add remote

**Files:** none (git operations only)

- [ ] **Step 1: Create and switch to branch `dropsh`**

```bash
git checkout -b dropsh
```

- [ ] **Step 2: Add the new remote**

```bash
git remote add pen-drop git@github.com:pen-drop/dropsh.git
```

- [ ] **Step 3: Verify**

```bash
git remote -v
```

Expected output includes `pen-drop  git@github.com:pen-drop/dropsh.git (fetch)`.

---

### Task 2: Rename binary files

**Files:**
- Rename: `bin/drupal-cli` → `bin/dropsh`
- Rename: `bin/drupal-cli-src` → `bin/dropsh-src`

- [ ] **Step 1: Rename the files**

```bash
git mv bin/drupal-cli bin/dropsh
git mv bin/drupal-cli-src bin/dropsh-src
```

- [ ] **Step 2: Verify contents are unchanged**

`bin/dropsh` should still read:
```js
#!/usr/bin/env node
import("../dist/src/index.js")
  .then((m) => m.main())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

`bin/dropsh-src` should still read:
```js
#!/usr/bin/env node
import("../src/index.js")
  .then((m) => m.main())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: rename bin/drupal-cli → bin/dropsh"
```

---

### Task 3: Root `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update `package.json`**

Replace the `name`, `description`, `bin`, and `repository` fields:

```json
{
  "name": "dropsh",
  "version": "0.0.1-alpha.0",
  "description": "Entity-agnostic helper CLI for Drupal 11 JSON:API, used by the dropsh Claude skill for editorial publishing workflows.",
  "type": "module",
  "bin": {
    "dropsh": "./bin/dropsh"
  },
  "exports": {
    ".": "./dist/src/index.js",
    "./plugin": "./dist/src/plugin-api.js"
  },
  "files": [
    "bin",
    "dist/src",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsc",
    "build:plugins": "npm --prefix plugins/schemata run build && npm --prefix plugins/oauth2 run build",
    "dev": "tsx src/index.ts",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest",
    "test:integration": "npm run build && vitest run -c vitest.config.integration.ts",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src/ tests/integrations/helpers/ tests/integrations/schema/ tests/integrations/*.ts",
    "lint:fix": "biome check --write src/ tests/integrations/helpers/ tests/integrations/schema/ tests/integrations/*.ts",
    "drupal:up": "bash tests/integrations/bin/drupal-up.sh",
    "drupal:down": "bash tests/integrations/bin/drupal-down.sh",
    "prepublishOnly": "npm run typecheck && npm run build"
  },
  "keywords": [
    "drupal",
    "drupal11",
    "jsonapi",
    "cli",
    "claude",
    "claude-skill",
    "editorial"
  ],
  "author": "Christian Wiedemann <gitlab@keytec.de>",
  "license": "(MIT OR GPL-2.0-or-later)",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/pen-drop/dropsh.git"
  },
  "dependencies": {
    "ajv": "^8.18.0",
    "commander": "^12.1.0",
    "drupal-jsonapi-params": "^3.0.1",
    "open": "^11.0.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.14",
    "@types/node": "^20.14.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: rename package drupal-cli → dropsh"
```

---

### Task 4: `src/index.ts`

**Files:**
- Modify: `src/index.ts`

Three occurrences to change:

| Line | Old | New |
|------|-----|-----|
| 44 | `process.env.DRUPAL_CLI_CONFIG ?? "drupal-cli.config.js"` | `process.env.DROPSH_CONFIG ?? "dropsh.config.js"` |
| 77 | `.name("drupal-cli")` | `.name("dropsh")` |
| 80 | `"path to config file (overrides DRUPAL_CLI_CONFIG)"` | `"path to config file (overrides DROPSH_CONFIG)"` |
| 110 | `` `${ctx.cwd}/.drupal-cli/cache` `` | `` `${ctx.cwd}/.dropsh/cache` `` |
| 130 | `"x-drupal-cli-source": source` | `"x-dropsh-source": source` |
| 131 | `"x-drupal-cli-target": { entity_type: entity, bundle }` | `"x-dropsh-target": { entity_type: entity, bundle }` |
| 132 | `"x-drupal-cli-operation": op` | `"x-dropsh-operation": op` |

- [ ] **Step 1: Apply changes to `src/index.ts`**

Line 44 — change `resolveConfigPath`:
```ts
return override ?? process.env.DROPSH_CONFIG ?? "dropsh.config.js";
```

Line 77–80 — change `.name()` and help text:
```ts
  program
    .name("dropsh")
    .description("Entity-agnostic CLI for Drupal 11 JSON:API")
    .version("0.0.0")
    .option("--config <path>", "path to config file (overrides DROPSH_CONFIG)");
```

Lines 110 — change cache root:
```ts
      rootDir: `${ctx.cwd}/.dropsh/cache`,
```

Lines 130–132 — change schema extension keys:
```ts
      "x-dropsh-source": source,
      "x-dropsh-target": { entity_type: entity, bundle },
      "x-dropsh-operation": op,
```

- [ ] **Step 2: Run typecheck to verify**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "chore: rename drupal-cli identifiers in src/index.ts"
```

---

### Task 5: `src/commands/schema.ts` and `src/core/schema/jsonschema-source.ts`

**Files:**
- Modify: `src/commands/schema.ts`
- Modify: `src/core/schema/jsonschema-source.ts`

- [ ] **Step 1: Update `src/commands/schema.ts`**

Line 31 — change cache dir:
```ts
  const store = createFileStore({ rootDir: join(deps.cwd, ".dropsh/cache"), warn: deps.warn });
```

Lines 82–84 — change schema extension keys:
```ts
    "x-dropsh-source": source,
    "x-dropsh-target": { entity_type: entity, bundle },
    "x-dropsh-operation": args.operation,
```

- [ ] **Step 2: Update `src/core/schema/jsonschema-source.ts`**

Line 46 — change error message:
```ts
        `no such target '${entity}/${bundle}'. Run 'dropsh schema' to see available targets.`,
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/commands/schema.ts src/core/schema/jsonschema-source.ts
git commit -m "chore: rename drupal-cli identifiers in schema source files"
```

---

### Task 6: Plugin — `@dropsh/plugin-schemata`

**Files:**
- Modify: `plugins/schemata/package.json`
- Modify: `plugins/schemata/src/index.ts`
- Modify: `plugins/schemata/src/schemata.ts`
- Modify: `plugins/schemata/vitest.config.ts`

- [ ] **Step 1: Update `plugins/schemata/package.json`**

```json
{
  "name": "@dropsh/plugin-schemata",
  "version": "0.0.1-alpha.0",
  "type": "module",
  "main": "./dist/plugins/schemata/src/index.js",
  "exports": {
    ".": "./dist/plugins/schemata/src/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "dropsh": "*"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Update `plugins/schemata/src/index.ts`**

```ts
import type { DrupalCliPlugin, PluginContext } from "dropsh/plugin";
import { HttpError } from "dropsh/plugin";
import { fetchSchemata, SCHEMATA_MISS } from "./schemata.js";
```

- [ ] **Step 3: Update `plugins/schemata/src/schemata.ts`**

Change the first two import lines from `"drupal-cli/plugin"` to `"dropsh/plugin"`:
```ts
import type { AuthAdapter, HttpClient } from "dropsh/plugin";
import { HttpError } from "dropsh/plugin";
```

- [ ] **Step 4: Update `plugins/schemata/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "dropsh/plugin": resolve(__dirname, "../../src/plugin-api.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 5: Run typecheck for the plugin**

```bash
npm --prefix plugins/schemata run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add plugins/schemata/
git commit -m "chore: rename drupal-cli → dropsh in plugin-schemata"
```

---

### Task 7: Plugin — `@dropsh/plugin-oauth2`

**Files:**
- Modify: `plugins/oauth2/package.json`
- Modify: `plugins/oauth2/src/token-store.ts`
- Modify: `plugins/oauth2/tests/unit/index.test.ts`
- Modify: `plugins/oauth2/tests/unit/oauth2.test.ts`
- Modify: `plugins/oauth2/tests/unit/oauth2-authcode.test.ts`
- Modify: `plugins/oauth2/tests/unit/login.test.ts`
- Modify: `plugins/oauth2/vitest.config.ts` (if present)

- [ ] **Step 1: Update `plugins/oauth2/package.json`**

```json
{
  "name": "@dropsh/plugin-oauth2",
  "version": "0.0.1-alpha.0",
  "type": "module",
  "main": "./dist/plugins/oauth2/src/index.js",
  "exports": {
    ".": "./dist/plugins/oauth2/src/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "dropsh": "*"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Update `plugins/oauth2/src/token-store.ts`**

Line 16 — change the config directory:
```ts
export function defaultTokenDir(): string {
  return join(homedir(), ".config", "dropsh");
}
```

- [ ] **Step 3: Update all oauth2 test imports**

In every file under `plugins/oauth2/tests/` that imports from `"drupal-cli/plugin"`, replace with `"dropsh/plugin"`. Files to change:
- `plugins/oauth2/tests/unit/index.test.ts`
- `plugins/oauth2/tests/unit/oauth2.test.ts`
- `plugins/oauth2/tests/unit/oauth2-authcode.test.ts`
- `plugins/oauth2/tests/unit/login.test.ts`
- `plugins/oauth2/tests/unit/token-store.test.ts`

For each file, change every occurrence of:
```ts
import ... from "drupal-cli/plugin";
```
to:
```ts
import ... from "dropsh/plugin";
```

Also in `login.test.ts` and `token-store.test.ts`, change temp dir prefixes:
```ts
// login.test.ts line 26
const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));

// token-store.test.ts line 8
const dir = mkdtempSync(join(tmpdir(), "dropsh-cache-"));
// token-store.test.ts line 40
const nested = join(dir, "sub", "dropsh");
```

- [ ] **Step 4: Update `plugins/oauth2/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "dropsh/plugin": resolve(__dirname, "../../src/plugin-api.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 5: Run typecheck for the plugin**

```bash
npm --prefix plugins/oauth2 run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add plugins/oauth2/
git commit -m "chore: rename drupal-cli → dropsh in plugin-oauth2"
```

---

### Task 8: Unit tests

**Files:**
- Modify: `tests/unit/index.test.ts`
- Modify: `tests/unit/smoke.test.ts`
- Modify: `tests/unit/commands/schema.test.ts`
- Modify: `tests/unit/core/cache/file-store.test.ts`

- [ ] **Step 1: Update `tests/unit/index.test.ts`**

Change every `parseAsync(["node", "drupal-cli", ...])` call to use `"dropsh"`:
```ts
await p.parseAsync(["node", "dropsh", "read", "node/article/abcdef01-abcd-abcd-abcd-abcdef012345"]);
```
(applies to lines 32, 57, 70 — all three occurrences)

- [ ] **Step 2: Update `tests/unit/smoke.test.ts`**

Same change:
```ts
await p.parseAsync(["node", "dropsh", "read", "node/article/abcdef01-abcd-abcd-abcd-abcdef012345"]);
```

- [ ] **Step 3: Update `tests/unit/commands/schema.test.ts`**

Line 13 — temp dir prefix:
```ts
  return mkdtempSync(join(tmpdir(), "dropsh-cmd-schema-"));
```

Lines 57–59 — schema key assertions:
```ts
    expect(out["x-dropsh-source"]).toBe("heuristic");
    expect(out["x-dropsh-target"]).toEqual({ entity_type: "node", bundle: "article" });
    expect(out["x-dropsh-operation"]).toBe("create");
```

- [ ] **Step 4: Update `tests/unit/core/cache/file-store.test.ts`**

Change temp dir prefix:
```ts
  return mkdtempSync(join(tmpdir(), "dropsh-cache-"));
```

- [ ] **Step 5: Run unit tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/
git commit -m "chore: update unit tests for dropsh rename"
```

---

### Task 9: Integration test helpers

**Files:**
- Modify: `tests/integrations/helpers/run.ts`
- Modify: `tests/integrations/create.test.ts`
- Modify: `tests/integrations/schema/schema-empty-bundle.integration.test.ts`
- Modify: `tests/integrations/schema/schema-source.integration.test.ts`
- Modify: `tests/integrations/schema/schema-jsonschema-update.integration.test.ts`

- [ ] **Step 1: Update `tests/integrations/helpers/run.ts`**

Line 117 — temp dir prefix:
```ts
  const dir = mkdtempSync(join(tmpdir(), "dropsh-it-"));
```

Line 118 — config file name:
```ts
  const cfgPath = join(dir, "dropsh.config.mjs");
```

Line 122 — bin path:
```ts
    const child = spawn("node", ["--import", "tsx/esm", "bin/dropsh-src", ...opts.args], {
```

Line 125 — env var:
```ts
        DROPSH_CONFIG: cfgPath,
```

- [ ] **Step 2: Update `tests/integrations/create.test.ts`**

Change temp dir prefix (line 50):
```ts
    const dir = mkdtempSync(join(tmpdir(), "dropsh-data-"));
```

- [ ] **Step 3: Update integration schema tests**

In `schema-empty-bundle.integration.test.ts`, `schema-source.integration.test.ts`, and `schema-jsonschema-update.integration.test.ts`, change every `x-drupal-cli-*` key assertion:

```ts
// schema-source.integration.test.ts
expect(schema["x-dropsh-source"]).toBe("schemata");
expect(schema["x-dropsh-target"]).toEqual({ entity_type: "node", bundle: "article_test" });
expect(schema["x-dropsh-operation"]).toBe("create");

// schema-empty-bundle.integration.test.ts
expect(schema["x-dropsh-source"]).toBe("schemata");

// schema-jsonschema-update.integration.test.ts
expect(schema["x-dropsh-operation"]).toBe("update");
```

- [ ] **Step 4: Commit**

```bash
git add tests/integrations/
git commit -m "chore: update integration tests for dropsh rename"
```

---

### Task 10: Config example, README, CLAUDE.md

**Files:**
- Rename: `drupal-cli.config.example.js` → `dropsh.config.example.js`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Rename config example**

```bash
git mv drupal-cli.config.example.js dropsh.config.example.js
```

- [ ] **Step 2: Update `README.md`**

Replace all occurrences of `drupal-cli` with `dropsh` and `DRUPAL_CLI_CONFIG` with `DROPSH_CONFIG` throughout the file. Use search-and-replace across the full file.

- [ ] **Step 3: Update `CLAUDE.md`**

Replace all occurrences of `drupal-cli` with `dropsh` throughout the file. Specifically update:
- Any mention of the CLI name
- The package name in the description
- References to the skill name

- [ ] **Step 4: Commit**

```bash
git add drupal-cli.config.example.js dropsh.config.example.js README.md CLAUDE.md
git commit -m "chore: rename config example and update docs for dropsh"
```

---

### Task 11: Full verification

- [ ] **Step 1: Run lint**

```bash
npm run lint
```

Expected: no errors. If there are formatting issues, run `npm run lint:fix` and commit the result.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Run unit tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 4: Search for any remaining old references**

```bash
grep -r "drupal-cli\|drupal_cli\|DRUPAL_CLI\|@drupal-cli" \
  src/ tests/ plugins/ bin/ package.json \
  --include="*.ts" --include="*.json" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=dist \
  -l
```

Expected: no output. If any files are found, fix them and commit.

---

### Task 12: Push to new remote

- [ ] **Step 1: Verify the branch is clean**

```bash
git status
```

Expected: `nothing to commit, working tree clean`.

- [ ] **Step 2: Push branch to new remote**

```bash
git push pen-drop dropsh
```

- [ ] **Step 3: Confirm push succeeded**

```bash
git log --oneline pen-drop/dropsh..HEAD
```

Expected: no output (branch is up to date with remote).
