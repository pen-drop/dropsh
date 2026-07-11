# init-worktree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `pnpm run init-worktree` dev command that derives a unique DDEV subdomain for the current worktree, regenerates the playground dropsh configs + the gitignored DDEV override from it, and runs the build chain — without starting Drupal.

**Architecture:** A pure lib (`scripts/init-worktree.lib.mjs`) computes the project name from `git` branch + worktree path and renders `__DDEV_PROJECT__`-tokenised templates. A thin orchestrator (`scripts/init-worktree.mjs`) wires git → derive → generate files → build. Playground configs move to tracked `*.template.js`; the generated `*.config.js` are gitignored per worktree.

**Tech Stack:** Node ESM (`node:child_process`, `node:crypto`, `node:fs`, `node:path`, `node:url`), vitest, pnpm.

## Global Constraints

- All committed artifacts in English (comments, log strings, docs).
- No new runtime/dev dependencies — Node built-ins only.
- Must **not** start or provision DDEV/Drupal (no `ddev start`, no `drupal:up`).
- Idempotent: every output is a pure function of the derived name; reruns leave `git status` clean.
- Before completion: `pnpm run lint`, `pnpm run typecheck`, `pnpm test` all green.
- Host scheme (from `playground/README.md`): default `NAME.ddev.site`; subsites `schemata.NAME.ddev.site`, `jsonapischema.NAME.ddev.site`, `canvas.NAME.ddev.site`, `db.NAME.ddev.site`.

---

### Task 1: Pure derivation + template lib (TDD)

**Files:**
- Create: `scripts/init-worktree.lib.mjs`
- Test: `tests/unit/scripts/init-worktree.test.ts`

**Interfaces:**
- Produces:
  - `slugify(input: string): string`
  - `deriveProjectName(branch: string, worktreeRoot: string): string`
  - `renderTemplate(source: string, projectName: string): string`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/scripts/init-worktree.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  deriveProjectName,
  renderTemplate,
  slugify,
} from "../../../scripts/init-worktree.lib.mjs";

describe("slugify", () => {
  it("lowercases and collapses non-alphanumerics to single hyphens", () => {
    expect(slugify("feat/DROPSH-5_init")).toBe("feat-dropsh-5-init");
  });
  it("trims leading/trailing separators", () => {
    expect(slugify("--a//b--")).toBe("a-b");
  });
  it("truncates to 40 chars with no trailing hyphen", () => {
    const s = slugify("a".repeat(50));
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("deriveProjectName", () => {
  it("combines slug + 8-hex hash of the worktree path", () => {
    expect(deriveProjectName("feat/x", "/home/cw/wt")).toMatch(/^feat-x-[0-9a-f]{8}$/);
  });
  it("is stable for the same worktree path", () => {
    expect(deriveProjectName("b", "/p")).toBe(deriveProjectName("b", "/p"));
  });
  it("differs across worktree paths on the same branch", () => {
    expect(deriveProjectName("b", "/p1")).not.toBe(deriveProjectName("b", "/p2"));
  });
  it("falls back to the worktree basename when detached (HEAD)", () => {
    expect(deriveProjectName("HEAD", "/home/cw/my-tree")).toMatch(/^my-tree-[0-9a-f]{8}$/);
  });
  it("falls back to a dropsh- prefix when the slug empties", () => {
    expect(deriveProjectName("///", "/p")).toMatch(/^dropsh-[0-9a-f]{8}$/);
  });
});

describe("renderTemplate", () => {
  it("replaces every token occurrence", () => {
    expect(renderTemplate("a __DDEV_PROJECT__ b __DDEV_PROJECT__", "x")).toBe("a x b x");
  });
  it("passes through when no token is present", () => {
    expect(renderTemplate("nothing", "x")).toBe("nothing");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/scripts/init-worktree.test.ts`
Expected: FAIL — cannot resolve `../../../scripts/init-worktree.lib.mjs`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/init-worktree.lib.mjs`:

```js
// Pure helpers for init-worktree — no side effects, unit-tested.
import { createHash } from "node:crypto";
import { basename } from "node:path";

/** DNS/DDEV-safe slug: lowercase, non-alphanumerics → single hyphen, trimmed, ≤40 chars. */
export function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/**
 * Derive a unique, deterministic DDEV project name for a worktree.
 * slug(branch) + 8-hex sha256(worktreeRoot); stable per worktree dir,
 * unique across worktrees even on the same branch.
 */
export function deriveProjectName(branch, worktreeRoot) {
  const raw = branch && branch !== "HEAD" ? branch : basename(worktreeRoot);
  const slug = slugify(raw);
  const hash = createHash("sha256").update(worktreeRoot).digest("hex").slice(0, 8);
  return slug ? `${slug}-${hash}` : `dropsh-${hash}`;
}

/** Replace every `__DDEV_PROJECT__` token with the derived name. */
export function renderTemplate(source, projectName) {
  return source.replaceAll("__DDEV_PROJECT__", projectName);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/scripts/init-worktree.test.ts`
Expected: PASS (all 10 assertions).

- [ ] **Step 5: Commit**

```bash
git add scripts/init-worktree.lib.mjs tests/unit/scripts/init-worktree.test.ts
git commit -m "feat(init-worktree): pure name-derivation + template lib"
```

---

### Task 2: Tokenised config templates + gitignore + package.json script

**Files:**
- Rename+edit: `playground/dropsh.config.js` → `playground/dropsh.config.template.js`
- Rename+edit: `playground/plain/dropsh.config.js` → `playground/plain/dropsh.config.template.js`
- Rename+edit: `playground/schemata/dropsh.config.js` → `playground/schemata/dropsh.config.template.js`
- Rename+edit: `playground/canvas/dropsh.config.js` → `playground/canvas/dropsh.config.template.js`
- Rename+edit: `playground/db/dropsh.config.js` → `playground/db/dropsh.config.template.js`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Produces: five `playground/**/dropsh.config.template.js` files, each with hosts written as `__DDEV_PROJECT__`-based names; `pnpm run init-worktree` script entry.

- [ ] **Step 1: Move the tracked configs to templates**

```bash
cd playground
git mv dropsh.config.js dropsh.config.template.js
git mv plain/dropsh.config.js plain/dropsh.config.template.js
git mv schemata/dropsh.config.js schemata/dropsh.config.template.js
git mv canvas/dropsh.config.js canvas/dropsh.config.template.js
git mv db/dropsh.config.js db/dropsh.config.template.js
cd ..
```

- [ ] **Step 2: Tokenise the host strings**

Edit each template so every hostname uses the `__DDEV_PROJECT__` token. Final contents:

`playground/dropsh.config.template.js` — root/kitchen-sink; retarget the stale `drupal-cli-test-schemata-*` host to the **default** site scheme, keep the plugin stack verbatim:

```js
import { markdownPlugin } from "@dropsh/plugin-markdown";
import { oauth2Plugin } from "@dropsh/plugin-oauth2";
import { schemataPlugin } from "@dropsh/plugin-schemata";
import { tablePlugin } from "@dropsh/plugin-table";
import { tuiPlugin } from "@dropsh/plugin-tui";

export default {
  site: {
    base_url: "http://__DDEV_PROJECT__.ddev.site",
    jsonapi_prefix: "/jsonapi",
  },
  plugins: [
    oauth2Plugin({
      type: "oauth2_authcode",
      client_id: "tests-authcode",
      token_url: "http://__DDEV_PROJECT__.ddev.site/oauth/token",
      scope: "integration:content",
      redirect_port: 7432,
    }),
    schemataPlugin(),
    // Render plugins: enable `--format md`, `--format table`, and `--format tui`.
    markdownPlugin(),
    tablePlugin(),
    tuiPlugin({
      defaultPageSize: 25,
      views: [
        {
          entityType: "node",
          bundle: "article_test",
          columns: ["title", "status"],
          filters: { status: "1" },
        },
      ],
    }),
  ],
};
```

`playground/plain/dropsh.config.template.js` — replace `dropsh-test` with `__DDEV_PROJECT__` in the header comment (`http://__DDEV_PROJECT__.ddev.site`), `base_url`, and `token_url`.

`playground/schemata/dropsh.config.template.js` — replace `schemata.dropsh-test` with `schemata.__DDEV_PROJECT__` in the header comment and `base_url`.

`playground/canvas/dropsh.config.template.js` — replace `canvas.dropsh-test` with `canvas.__DDEV_PROJECT__` in the header comment, `base_url`, and `token_url`.

`playground/db/dropsh.config.template.js` — replace `db.dropsh-test` with `db.__DDEV_PROJECT__` in the header comment, `base_url`, and `token_url`.

(Only host strings change; plugin arrays stay byte-for-byte identical to the originals.)

- [ ] **Step 3: Gitignore the generated configs**

Edit `.gitignore`. Replace the line `playground/canvas/` with:

```gitignore
# Per-worktree generated dropsh configs (produced by `pnpm run init-worktree`)
playground/dropsh.config.js
playground/plain/dropsh.config.js
playground/schemata/dropsh.config.js
playground/canvas/dropsh.config.js
playground/db/dropsh.config.js
```

- [ ] **Step 4: Add the pnpm script**

Edit `package.json` `scripts`, add after `"drupal:down"`:

```json
    "init-worktree": "node scripts/init-worktree.mjs",
```

- [ ] **Step 5: Verify the working tree is clean of generated names**

Run: `git status --short playground/`
Expected: shows the five renames to `*.template.js`; no tracked `dropsh.config.js` remain (they are now gitignored/untracked once generated).

- [ ] **Step 6: Commit**

```bash
git add -A playground/ .gitignore package.json
git commit -m "feat(init-worktree): tokenised playground config templates + pnpm script"
```

---

### Task 3: Orchestrator script + README

**Files:**
- Create: `scripts/init-worktree.mjs`
- Modify: `playground/README.md`

**Interfaces:**
- Consumes: `deriveProjectName`, `renderTemplate` from `scripts/init-worktree.lib.mjs` (Task 1); the five templates + `.gitignore` (Task 2).

- [ ] **Step 1: Write the orchestrator**

Create `scripts/init-worktree.mjs`:

```js
#!/usr/bin/env node
// Make a fresh dropsh worktree usable WITHOUT provisioning Drupal:
// derive a unique DDEV project name, regenerate the playground configs +
// the gitignored DDEV override from it, then build. Never starts DDEV.
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveProjectName, renderTemplate } from "./init-worktree.lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const worktreeRoot = git(["rev-parse", "--show-toplevel"]);
const name = deriveProjectName(branch, worktreeRoot);

const TEMPLATES = [
  "playground/dropsh.config.template.js",
  "playground/plain/dropsh.config.template.js",
  "playground/schemata/dropsh.config.template.js",
  "playground/canvas/dropsh.config.template.js",
  "playground/db/dropsh.config.template.js",
];

for (const rel of TEMPLATES) {
  const src = readFileSync(join(ROOT, rel), "utf8");
  const outRel = rel.replace(/\.template\.js$/, ".js");
  writeFileSync(join(ROOT, outRel), renderTemplate(src, name));
  console.log(`generated ${outRel}`);
}

const ddevDir = join(ROOT, "tests/integrations/drupal/.ddev");
mkdirSync(ddevDir, { recursive: true });
const localYaml = [
  "# Generated by `pnpm run init-worktree` — per-worktree DDEV project name.",
  "# Gitignored; safe to delete/regenerate. Does NOT start DDEV.",
  `name: ${name}`,
  "additional_hostnames:",
  `  - schemata.${name}`,
  `  - jsonapischema.${name}`,
  `  - canvas.${name}`,
  `  - db.${name}`,
  "",
].join("\n");
writeFileSync(join(ddevDir, "config.local.yaml"), localYaml);
console.log(`generated tests/integrations/drupal/.ddev/config.local.yaml (name: ${name})`);

console.log("\nBuilding workspace…");
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: "inherit" });
run("pnpm install");
run("pnpm run build");
run("pnpm run build:plugins");
run("pnpm --dir playground install");

console.log(
  `\nWorktree ready. DDEV project: ${name}.ddev.site ` +
    "(not started — run `pnpm run drupal:up` to provision).",
);
```

- [ ] **Step 2: Run it in this worktree**

Run: `pnpm run init-worktree`
Expected: logs five `generated playground/...dropsh.config.js` lines + the `config.local.yaml` line with a `feat-dropsh-5-init-worktree-pe-<hash8>` name, then a successful install/build/build:plugins/playground-install.

- [ ] **Step 3: Assert generated output + idempotency**

Run:
```bash
grep -h ddev.site playground/*/dropsh.config.js playground/dropsh.config.js
git status --short
pnpm run init-worktree >/dev/null && git status --short
```
Expected: hosts all carry the derived `NAME`; `git status` shows **no** tracked-file changes from generation (only untracked generated configs are gitignored); the second run leaves status identical (idempotent).

- [ ] **Step 4: Update the playground README**

Edit `playground/README.md` — replace the static `dropsh-test` URL table + `## Setup` block so the setup starts with `pnpm run init-worktree` (which generates the per-worktree configs + builds), note that URLs are now `<derived>.ddev.site` / `<sub>.<derived>.ddev.site`, and that `drupal:up` provisioning against the derived name is a separate step. Keep the per-scenario usage sections.

- [ ] **Step 5: Full gate**

Run: `pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all green (new unit tests included).

- [ ] **Step 6: Commit**

```bash
git add scripts/init-worktree.mjs playground/README.md
git commit -m "feat(init-worktree): orchestrator script + README flow"
```

---

## Self-Review

- **Spec coverage:** derivation → Task 1 + Task 3/Step 1; config generation (root + 4 subsites) → Task 2 (templates) + Task 3 (render); DDEV override → Task 3; build chain → Task 3/Step 1; no DDEV start → orchestrator never calls `ddev`; idempotency → Task 3/Step 3 + pure derivation. All acceptance criteria mapped.
- **Placeholder scan:** none — every code/step is concrete.
- **Type consistency:** `deriveProjectName`/`renderTemplate`/`slugify` names + signatures identical across Task 1 (definition), its tests, and Task 3 (consumer). Token `__DDEV_PROJECT__` identical in templates + `renderTemplate`.

## Out of scope (follow-ups)

- Teaching `drupal:up` + `tests/integrations/helpers/config.ts` to consume the derived name (integration tests still hardcode `dropsh-test.ddev.site`).
- Actually provisioning/starting DDEV.
