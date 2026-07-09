# dropsh — WORKFLOW

Per-state **policy overrides** for this repo, consumed by the `gaia` skill. Each `## State: <state>`
section carries a YAML config object with **only the keys this project overrides**; every omitted
key (and every empty section) takes the engine default.

- **Schema, vocabularies, engine defaults, and the defaults-⊕-overrides merge rule** live in the
  skill: `.claude/skills/gaia/reference/workflow-config.md`.
- **Mechanics** (dispatch, auth, payload shapes, merge signature, phase-comment + acceptance→test→
  .feature lifecycle) live in `.claude/skills/gaia/SKILL.md` + `reference/**`.
- **No** general prose, decision tables, dropsh `--data` JSON, or step-by-step HOW belong in this
  file — only this project's overrides. Validate with the `gaia` skill's `workflow:validate` workflow.

In practice the only project-specific content is the `sub_decisions` `then` actions below (this
repo's design/test/verify tooling). Fill in what applies; delete the `sub_decisions` a state does
not need. Everything else runs on engine defaults.

## State: triage

```yaml
# defaults suffice
```

## State: spec

```yaml
# defaults suffice — dropsh is a headless CLI, no UI/design surface to plan
```

## State: diagnose

```yaml
# defaults suffice
```

## State: coding

```yaml
sub_decisions:
  - if: runtime_surface
    then: >-
      Build the change test-first (vitest). Run `pnpm test` for unit coverage;
      run `pnpm run test:integration` against a live DDEV instance for
      HTTP/auth/schema paths. Both must be green before transition.
  - if: app_change
    then: >-
      `pnpm run drupal:up && pnpm run test:integration && pnpm run drupal:down`
      (provision DDEV + Drupal, run the integration suite, tear down).
```

## State: review

```yaml
# defaults suffice (green_pipeline precondition, confirm-gate, ok→done / not_ok→coding)
```
