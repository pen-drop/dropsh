# GitLab CI: TypeScript Validation Pipeline

**Date:** 2026-04-24
**Status:** Approved
**Scope:** drupal-cli repository on git.drupal.org

## Goal

Introduce a GitLab CI pipeline that automatically validates every merge request and every push to the default branch (`1.0.x`). Validation consists of TypeScript type-checking and the existing Vitest unit-test suite, run in a Node version matrix (20 and 22).

Integration tests (which require DDEV) are explicitly excluded — they remain local-only.

## Architecture

A single `.gitlab-ci.yml` file in the repository root defines the pipeline. No external templates are included; the drupal.org `gitlab_templates` project is PHP/Drupal-centric and does not apply to this Node CLI.

## Pipeline Structure

One stage: `validate`. Two jobs, each expanded via a Node version matrix:

```
validate
├── typecheck [node:20-alpine]
├── typecheck [node:22-alpine]
├── test      [node:20-alpine]
└── test      [node:22-alpine]
```

The four jobs run in parallel. There is no fail-fast setting within the matrix — a failing `typecheck` job does not abort the `test` jobs and vice versa, so both dimensions of failure are always visible.

### Job: `typecheck`

```
npm ci
npm run typecheck   # tsc --noEmit
```

Fails on any TypeScript type error. Uses the existing `typecheck` script already defined in `package.json`.

### Job: `test`

```
npm ci
npm test            # vitest run --passWithNoTests
```

Runs the Vitest unit suite. Uses the existing `test` script. The `--passWithNoTests` flag is already in place so an empty suite is not an error.

## Runner and Image

- **Runner:** drupal.org shared runners (no explicit tags, default pool)
- **Base image:** `node:$NODE_VERSION-alpine` where `$NODE_VERSION` is the matrix variable (`20` or `22`)
- Alpine images are used for their small size; the pipeline needs no OS-level dependencies beyond Node and npm

## Caching

The npm cache directory (`~/.npm`) is cached per Node version and per `package-lock.json` hash:

```
key: "$CI_JOB_NAME-node$NODE_VERSION-<hash of package-lock.json>"
paths:
  - .npm/
```

The cache key combines job name, Node version, and the `package-lock.json` hash (via `$CI_COMMIT_SHORT_SHA` on the lock file using GitLab's `files:` key syntax). `npm ci` is invoked with `--cache .npm` to direct it to the cached directory. `node_modules/` is not cached — `npm ci` always produces a clean install.

## Trigger Rules

`workflow:rules` prevent duplicate pipelines (the GitLab default produces both a branch pipeline and a detached MR pipeline for the same commit):

| Event | Pipeline runs? |
|-------|---------------|
| Merge request open / push to MR branch | Yes |
| Push to `1.0.x` (default branch) | Yes |
| Push to any other branch without an open MR | No |
| Tag push | No |

## Files Changed

| File | Action |
|------|--------|
| `.gitlab-ci.yml` | **New** — full pipeline definition |

No changes to `package.json`, `tsconfig.json`, or `vitest.config.ts`. All required npm scripts already exist.

## Acceptance Criteria

1. Pipeline runs green on a clean push to `1.0.x`.
2. A deliberate TypeScript error causes both `typecheck` jobs to fail without affecting `test` jobs.
3. A deliberate test failure causes both `test` jobs to fail without affecting `typecheck` jobs.
4. No pipeline is triggered for a branch push that has no open merge request.
5. Target pipeline duration on cached shared runner: under 3 minutes.
