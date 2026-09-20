# dropsh — WORKFLOW

Read the complete ticket and comments, then execute only the current state's section of its loaded
GAIA owner. `@gaia/workflow-step` owns the exactly-one-match lifecycle contract and multi-work order.
This file selects context; the step-owning skills choose transitions and STOP at the state boundary.

## Loaded skills

- @gaia/essential-skills
- @gaia/method-context
- @gaia/ddev-drupal-bug
- @gaia/ddev-drupal-feature
- @gaia/docs-authoring

`work:code` uses the two code owners; `@gaia/docs-authoring` supplies `work:docs` with proportional
documentation checks. Helpers do not route.

## Skill set

One or more entries, one per line; the first is the project default. With two or more listed,
qualification asks which to use and records the answer as a `method:*` label.

- `@gaia/method-context` → `references/superpowers.md`

## Skills

Binding under [Required skills](#required-skills). Apply all matching rows.

| When | Skill |
|---|---|

## Checks

Apply all matching rows to the plan and final diff. Run commands from the repository root; deduplicate.
Ticket-specific functional checks apply separately.

| When | Command |
|---|---|
| Any code change | `pnpm run lint` |
| Any code change | `pnpm run typecheck` |
| Any code change | `pnpm test` |
| HTTP, auth or schema paths | `pnpm run test:integration` |

### Setup

| When | Setup |
|---|---|
| Skill availability | Agent environment's own installation and discovery facilities. |
| `pnpm run test:integration` | `pnpm run drupal:up` provisions the shared `dropsh-test` DDEV multisite once on the host; `pnpm run drupal:down` tears it down. |

## Required skills

Selected skill-set entries, matching `Skills` rows, and `.prompt` values are **binding**: load every
skill it requires before doing the work it governs. **Load** means invoke the skill and read its
**complete** `SKILL.md`, then announce what you loaded. Equivalent reasoning, paraphrasing the method,
or naming a skill afterwards does **not** count.

**If a required skill is missing** — the value cannot be resolved, or a skill it names cannot be
resolved or read — **stop and report the exact identifier that failed**. Stop *before* editing a file,
committing, publishing a comment, asking for confirmation, or transitioning the ticket.

## Standards

Repository conventions live in `CLAUDE.md`: all committed artifacts are English; run `pnpm run lint`,
`pnpm run typecheck` and `pnpm test` before every commit; integration tests require a live DDEV
instance. dropsh is a Node.js + TypeScript CLI (entity-agnostic Drupal 11 JSON:API helper), not a
Drupal application — there is no per-worktree DDEV; the integration target is the shared `dropsh-test`
multisite. Commit format and MR target follow the release-branch model (`1.0.x` is the default MR
target).
