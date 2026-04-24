# GitLab CI: TypeScript Validation Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `.gitlab-ci.yml` that runs `tsc --noEmit` and Vitest unit tests on Node 20 and 22 for every MR and every push to `1.0.x` on git.drupal.org.

**Architecture:** Single file at the repo root. Two jobs (`typecheck`, `test`) each expanded via `parallel: matrix:` over Node versions 20 and 22. A shared `extends` template provides npm cache configuration. `workflow:rules` prevent duplicate pipelines.

**Tech Stack:** GitLab CI YAML, Node.js alpine Docker images, npm, TypeScript (`tsc`), Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `.gitlab-ci.yml` | **Create** | Full pipeline definition: workflow rules, cache template, typecheck job, test job |

No changes to `package.json`, `tsconfig.json`, `vitest.config.ts` — all required scripts already exist.

---

## Task 1: Create `.gitlab-ci.yml`

**Files:**
- Create: `.gitlab-ci.yml`

- [ ] **Step 1: Write `.gitlab-ci.yml`**

Create the file at the repository root with this exact content:

```yaml
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

stages:
  - validate

.node_cache:
  cache:
    key:
      files:
        - package-lock.json
      prefix: "node${NODE_VERSION}"
    paths:
      - .npm/

typecheck:
  extends: .node_cache
  stage: validate
  parallel:
    matrix:
      - NODE_VERSION: ["20", "22"]
  image: node:${NODE_VERSION}-alpine
  script:
    - npm ci --cache .npm
    - npm run typecheck

test:
  extends: .node_cache
  stage: validate
  parallel:
    matrix:
      - NODE_VERSION: ["20", "22"]
  image: node:${NODE_VERSION}-alpine
  script:
    - npm ci --cache .npm
    - npm test
```

Key design decisions captured here:
- `workflow:rules` — only MR events and default-branch pushes trigger a pipeline; unattached branch pushes are silently skipped
- `.node_cache` with `key.files: [package-lock.json]` — cache busts automatically when lock file changes; the `prefix: "node${NODE_VERSION}"` keeps Node 20 and 22 caches separate while allowing `typecheck` and `test` jobs for the same Node version to share one cache entry
- `parallel: matrix:` — GitLab expands each job into two named instances, e.g. `typecheck: [NODE_VERSION:20]` and `typecheck: [NODE_VERSION:22]`; all four run in parallel with no inter-job dependency
- `npm ci --cache .npm` — directs npm to use `.npm/` as its cache directory, which matches the GitLab cache `paths` entry

- [ ] **Step 2: Validate YAML syntax locally**

`js-yaml` is already a dependency of this project. Run:

```bash
node -e "import('js-yaml').then(m => { m.default.load(require('fs').readFileSync('.gitlab-ci.yml','utf8')); console.log('YAML valid'); })"
```

Expected output:
```
YAML valid
```

If you see a `YAMLException`, fix the syntax error it reports before continuing.

- [ ] **Step 3: Commit**

```bash
git add .gitlab-ci.yml
git commit -m "feat: add gitlab ci pipeline for typecheck and unit tests"
```

---

## Task 2: Verify pipeline runs green on drupal.org

This task requires access to `git.drupal.org`. The pipeline cannot be tested locally — it must run on the drupal.org shared runners.

**Files:** none (no code changes)

- [ ] **Step 1: Push to a feature branch**

```bash
git checkout -b ci/gitlab-ci-typescript
git push -u origin ci/gitlab-ci-typescript
```

- [ ] **Step 2: Open a Merge Request on git.drupal.org**

Go to `https://git.drupal.org/project/drupal_cli` → New Merge Request from `ci/gitlab-ci-typescript` into `1.0.x`. Opening the MR triggers the `merge_request_event` pipeline.

- [ ] **Step 3: Verify all four jobs appear**

In the pipeline view, confirm you see exactly these four jobs running in parallel:
- `typecheck: [NODE_VERSION:20]`
- `typecheck: [NODE_VERSION:22]`
- `test: [NODE_VERSION:20]`
- `test: [NODE_VERSION:22]`

If you see fewer than four jobs, the `parallel: matrix:` syntax was not parsed correctly — check the YAML against Step 1 of Task 1. Note: `parallel: matrix:` with image variable interpolation requires GitLab 14.5+; drupal.org runs a current GitLab version so this is supported.

- [ ] **Step 4: Verify no pipeline runs for an unattached branch push**

Create a second local branch, push it without opening an MR, and confirm no pipeline is triggered:

```bash
git checkout -b ci/no-pipeline-test
git commit --allow-empty -m "test: verify no pipeline for unattached branch"
git push -u origin ci/no-pipeline-test
```

Go to `https://git.drupal.org/project/drupal_cli/-/pipelines`. Confirm no new pipeline appears for `ci/no-pipeline-test`. If one does appear, the `workflow:rules` block is not applying — double-check that there is no `rules:` at job level that overrides the workflow rules.

Clean up:

```bash
git checkout ci/gitlab-ci-typescript
git push origin --delete ci/no-pipeline-test
git branch -d ci/no-pipeline-test
```

- [ ] **Step 5: Verify the pipeline goes green**

All four jobs must pass. Common failure modes and their causes:

| Symptom | Likely cause |
|---------|-------------|
| `npm ci` hangs or fails | Alpine image missing git or python; unlikely for this project |
| `typecheck` fails with TS errors | Existing type errors in source — run `npm run typecheck` locally to confirm |
| `test` fails | Existing test failures — run `npm test` locally to confirm |
| All jobs fail immediately | `image:` variable expansion failed; confirm GitLab version supports `parallel: matrix:` with image interpolation |

---

## Task 3: Smoke-test failure isolation

Verify that a `typecheck` failure does not abort `test` jobs and vice versa (no fail-fast). This confirms the parallel design works as intended.

**Files:** temporary modifications to `src/index.ts` and one test file, each reverted after the check.

- [ ] **Step 1: Introduce a deliberate TypeScript error**

Open `src/index.ts` and add a type violation near the top, e.g.:

```typescript
const _smokeTestTypeFail: number = "this is not a number";
```

- [ ] **Step 2: Push and observe**

```bash
git add src/index.ts
git commit -m "test: deliberate TS error for CI smoke test"
git push
```

Expected result in the pipeline:
- `typecheck: [NODE_VERSION:20]` — FAILED
- `typecheck: [NODE_VERSION:22]` — FAILED
- `test: [NODE_VERSION:20]` — PASSED
- `test: [NODE_VERSION:22]` — PASSED

If all four jobs fail, the jobs are not independent — check that `extends: .node_cache` is not inadvertently adding a dependency or `needs:` clause.

- [ ] **Step 3: Revert the TS error**

```bash
git revert HEAD --no-edit
git push
```

Wait for the pipeline to go green before continuing.

- [ ] **Step 4: Introduce a deliberate test failure**

Locate any unit test file in `tests/unit/`. Add a failing assertion, e.g. in `tests/unit/` find any test and add:

```typescript
it('smoke: deliberate failure for CI validation', () => {
  expect(1).toBe(2);
});
```

- [ ] **Step 5: Push and observe**

```bash
git add tests/
git commit -m "test: deliberate test failure for CI smoke test"
git push
```

Expected result in the pipeline:
- `typecheck: [NODE_VERSION:20]` — PASSED
- `typecheck: [NODE_VERSION:22]` — PASSED
- `test: [NODE_VERSION:20]` — FAILED
- `test: [NODE_VERSION:22]` — FAILED

- [ ] **Step 6: Revert the test failure and merge**

```bash
git revert HEAD --no-edit
git push
```

Once the pipeline is green, the MR is ready to merge.
