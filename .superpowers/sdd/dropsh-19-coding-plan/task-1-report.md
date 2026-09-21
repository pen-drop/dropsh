# Task 1 Report: Lock the package-entry-point contract

## What changed

- Added `tests/unit/plugin-api-connections.test.ts`, importing the required value and type symbols from the literal `dropsh/plugin` specifier.
- Added direct value and type re-export blocks for the connections API in `src/plugin-api.ts`.

## Self-review

- The public API is additive and delegates directly to `./core/connections.js`.
- The test asserts the required config filename and runtime function exports, while typed sample values verify declaration availability during typechecking.
- No existing behavior in `src/core/connections.ts` was changed.
- `git diff --check` passes; focused Biome formatting/lint passes for both changed files.

## TDD evidence

RED:

```text
pnpm exec vitest run tests/unit/plugin-api-connections.test.ts
```

Result: 1 test failed. `CWD_CONFIG_FILE` was `undefined` instead of `"dropsh.config.js"`, demonstrating the expected missing package-entry-point export.

GREEN:

```text
pnpm exec vitest run tests/unit/plugin-api-connections.test.ts
```

Result: 1 test passed.

## Required verification

- `pnpm run lint` — failed on pre-existing repository diagnostics: 57 warnings and one unrelated error in `packages/sdc-client/tests/unit/index.test.ts`; no diagnostics referenced the changed files.
- `pnpm run typecheck` — passed, including package builds and workspace typechecks.
- `pnpm test` — passed: 47 files, 430 tests.
- `pnpm exec biome check src/plugin-api.ts tests/unit/plugin-api-connections.test.ts` — passed after formatting.

## Commit

Commit created with the required `ref: DROPSH-19` trailer.
