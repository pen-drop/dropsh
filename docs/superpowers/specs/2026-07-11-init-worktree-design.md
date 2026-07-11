# init-worktree — per-worktree DDEV subdomain + generated dropsh/playground configs

**Ticket:** DROPSH-5 (`gaia_feature`)
**Date:** 2026-07-11
**Status:** spec

## Problem

Every git worktree of dropsh shares one hard-coded DDEV hostname. The root
`playground/dropsh.config.js` is committed with a stale subdomain
(`drupal-cli-test-schemata-5fdcffda.ddev.site`) that matches no running project,
and the per-scenario playground configs all point at the shared multisite
fixture (`*.dropsh-test.ddev.site`). A fresh worktree therefore needs manual
config surgery before the playground — or a live `--format tui` run — works, and
two worktrees that both provision Drupal collide on the same hostname.

## Goal

A single dev command that makes a freshly-created worktree usable **without**
provisioning Drupal:

1. Derive a unique DDEV subdomain for the current worktree (from the branch +
   worktree path), deterministically.
2. Regenerate every dropsh playground config (root + per-scenario subsite) to
   point at that subdomain.
3. Write the gitignored per-worktree DDEV override so a later provisioning step
   serves the same subdomain.
4. Run the build chain so the worktree is immediately usable.

Explicitly **out of scope:** starting or provisioning DDEV/Drupal (`drupal:up`
stays the separate, explicit step), and teaching `drupal:up` /
`tests/integrations/helpers/config.ts` to consume the derived name (follow-up).

## Decisions (agreed with operator)

- **Command surface:** dev-only pnpm script — `scripts/init-worktree.mjs`, wired
  as `pnpm run init-worktree`. Mirrors `drupal:up`; keeps the published `dropsh`
  bin free of dev-only bootstrap.
- **Config strategy:** template + gitignored output. Each playground config
  becomes a tracked `dropsh.config.template.js`; the script generates a
  gitignored sibling `dropsh.config.js`. Reruns produce identical bytes and
  leave `git status` clean.
- **DDEV hook:** the script also writes the gitignored
  `tests/integrations/drupal/.ddev/config.local.yaml` (already reserved in
  `.gitignore`) with the derived project `name` + subsite `additional_hostnames`
  — so a later `ddev start` serves the same subdomain. Still no DDEV start here.

## Subdomain derivation

Pure function `deriveProjectName(branch, worktreeRoot) -> string`:

- `branch` = `git rev-parse --abbrev-ref HEAD` (fallback: basename of
  `worktreeRoot` when detached / `HEAD`).
- `slug` = `branch` lowercased, every run of non-`[a-z0-9]` collapsed to `-`,
  leading/trailing `-` trimmed, truncated to 40 chars.
- `hash` = first 8 hex of `sha256(worktreeRoot)` — stable per worktree directory
  (⇒ idempotent) and unique across worktrees even on the same branch.
- `name` = `${slug}-${hash}`; if `slug` is empty, `dropsh-${hash}`. Guaranteed
  DDEV-safe (lowercase, alnum + hyphen, well under 63 chars).

Example: worktree on `feat/dropsh-5-init-worktree-pe` →
`feat-dropsh-5-init-worktree-pe-<hash8>`.

## Host mapping

Derived project `NAME` drives the multisite hosts (matching the existing fixture
scheme in `playground/README.md`):

| Config                             | Host                              |
|------------------------------------|-----------------------------------|
| `playground/dropsh.config.js`      | `NAME.ddev.site` (default site)   |
| `playground/plain/dropsh.config.js`| `NAME.ddev.site`                  |
| `playground/schemata/…`            | `schemata.NAME.ddev.site`         |
| `playground/canvas/…`              | `canvas.NAME.ddev.site`           |
| `playground/db/…`                  | `db.NAME.ddev.site`               |

The root config's stale schemata-style host is corrected to the default-site
scheme; each config's **plugin stack is preserved verbatim** — only host strings
change (no plugin-stack refactor in this ticket).

## Templating mechanism

Templates carry the literal token `__DDEV_PROJECT__` inside their host strings
(`http://__DDEV_PROJECT__.ddev.site`, `http://schemata.__DDEV_PROJECT__.ddev.site`,
…). The script reads each `**/dropsh.config.template.js`, replaces every
`__DDEV_PROJECT__` with `NAME`, and writes the sibling `dropsh.config.js`. A
single token keeps generation trivial and robust.

## Files

**New (tracked):**
- `scripts/init-worktree.mjs` — orchestrator (Node ESM, no new deps:
  `node:child_process`, `node:crypto`, `node:fs`, `node:path`).
- `playground/dropsh.config.template.js`
- `playground/plain/dropsh.config.template.js`
- `playground/schemata/dropsh.config.template.js`
- `playground/canvas/dropsh.config.template.js`
- `playground/db/dropsh.config.template.js`

**Migrated:** `git mv` each existing `playground/**/dropsh.config.js` →
`.template.js`, then tokenize the host.

**Generated (gitignored, per worktree):**
- `playground/**/dropsh.config.js`
- `tests/integrations/drupal/.ddev/config.local.yaml`

**Edited:**
- `package.json` — add `"init-worktree": "node scripts/init-worktree.mjs"`.
- `.gitignore` — ignore the five generated `playground/**/dropsh.config.js`;
  narrow `playground/canvas/` to `playground/canvas/dropsh.config.js` so the
  canvas template is trackable.
- `playground/README.md` — document the `pnpm run init-worktree` flow.

The five currently-tracked configs are removed from the index (`git rm --cached`
via the `git mv` to `.template.js` + gitignoring the generated names).

## Build chain

After generation the script runs, in order:

1. `pnpm install` (root workspace: `plugins/*`, `packages/*`)
2. `pnpm run build`
3. `pnpm run build:plugins`
4. `pnpm --dir playground install` (playground is **not** a workspace member; it
   has its own `file:` deps + lockfile and must be installed for the playground
   to run)

## Idempotency

Every output is a pure function of `NAME`, which is stable for a given worktree
directory. A second run overwrites the generated configs and `config.local.yaml`
with byte-identical content and re-runs the (idempotent) install/build chain. No
tracked file is dirtied.

## Testing

- Unit (vitest): `deriveProjectName` (slug sanitizing, truncation, hash
  stability, detached-HEAD fallback, empty-slug fallback) and the template
  renderer (token replacement, multiple occurrences, no-token passthrough).
- Manual verification (coding state): run `pnpm run init-worktree` in this
  worktree, assert generated hosts + `config.local.yaml`, rerun to confirm a
  clean `git status` and identical output.

## Risks / follow-ups

- **Integration-test coupling:** `config.local.yaml` renames the DDEV project to
  `NAME`, but `tests/integrations/helpers/config.ts` still hardcodes
  `dropsh-test.ddev.site`. After a future `drupal:up` on the renamed project the
  integration suite would need matching hosts. Teaching `drupal:up` +
  `helpers/config.ts` to consume `NAME` is a separate ticket; called out so the
  operator can veto the `config.local.yaml` step if they prefer to keep the
  shared fixture untouched.
- **DDEV `name` override:** relies on DDEV merging `name` from
  `config.local.yaml`; verified in coding before relying on it for provisioning.
