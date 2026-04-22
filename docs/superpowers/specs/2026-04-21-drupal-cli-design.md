# drupal-cli — Design Spec

**Date:** 2026-04-21
**Status:** Approved for implementation planning
**Language:** All artifacts (code, CLI, skill, mode markdowns, docs, commit messages) are written in English.

---

## 1. Purpose

`drupal-cli` is a tooling bundle that lets an editor bring Markdown-based content
into a running Drupal 11 site. It consists of three layers:

1. **A thin, entity-agnostic CLI** that speaks Drupal JSON:API.
2. **A Claude skill** that orchestrates the editorial workflow, reads the
   Markdown input, decides the target mode, and drives the CLI.
3. **Per-target "mode" markdowns** that act as playbooks telling the skill how
   to map editorial intent onto a JSON:API payload for a specific target
   (classic node, Canvas page, Display Builder landing page, …).

## 2. Goals

- Turn `editor.md` → published Drupal entity via a natural, interactive workflow.
- Support multiple target shapes from day one: classic node, Drupal Canvas
  page, Display Builder landing page.
- Make adding a new target trivial: drop a new mode markdown into the skill
  repo, no CLI change required.
- Stay discovery-driven: the toolchain reads the live Drupal install to learn
  what entity types, bundles, fields, components, templates and moderation
  workflows exist — nothing is hard-coded.
- Keep the CLI entity-agnostic: no per-entity-type code paths, no per-field
  special cases. Commands operate over `{entity_type}/{bundle}` generically.

## 3. Non-goals (MVP)

- No automatic rollback of partial successes. Failures become dialog events.
- No multi-instance profiles in one project config. One project = one target site.
- No paragraphs or Layout Builder support in the MVP (extensible later via a new mode markdown).
- No UUID round-trip stored automatically in frontmatter. Metadata write-back is opt-in, one document at a time.
- No built-in scheduler. The skill is invoked explicitly by the editor.

## 4. Scope of the MVP

In scope (per field taxonomy from brainstorming):

- (a) Text / numeric fields (title, body, summary, custom fields)
- (b) Images / media uploads via JSON:API
- (c) Taxonomy terms (reference existing; create missing on demand)
- (d) Entity references between nodes (resolve by title/UUID)
- (g) Drupal Canvas components (requires Canvas module)
- (h) Moderation state (default: published when the skill is invoked directly)
- (i) Path aliases and metatags
- Display Builder landing pages (custom mode markdown)

Out of scope for the MVP: paragraphs, Layout Builder sections, media types
other than image/file, custom workflows beyond Content Moderation, revisions
APIs, translations.

## 5. Architecture

Three layers, each with a clear responsibility boundary:

```
┌────────────────────────────────────────────────────────┐
│  Skill  (Claude, Markdown-based)                       │
│  • Reads editor markdown + frontmatter                 │
│  • Chooses the target mode                             │
│  • Loads the corresponding mode-*.md as its playbook   │
│  • Converses with the editor when information is       │
│    missing or ambiguous                                 │
│  • Drives the CLI for every Drupal interaction         │
└──────────────────────┬─────────────────────────────────┘
                       │ subprocess calls (stdin/stdout JSON)
                       ▼
┌────────────────────────────────────────────────────────┐
│  CLI  (Node.js + TypeScript, entity-agnostic)          │
│  • discover, schema, search, read, create, update,     │
│    delete, upload-file, clean                          │
│  • Auth, retries, JSON:API mechanics                   │
│  • Knows no modes, no field names, no markdown         │
└──────────────────────┬─────────────────────────────────┘
                       │ JSON:API (HTTP/HTTPS)
                       ▼
┌────────────────────────────────────────────────────────┐
│  Drupal 11                                             │
│  Modules: JSON:API, Canvas, Display Builder, Media,    │
│  Pathauto, Metatag, Content Moderation, …              │
│  Plus small companion module `drupal_cli_info` that    │
│  exposes module/feature details not reachable via      │
│  plain JSON:API.                                        │
└────────────────────────────────────────────────────────┘
```

**Responsibility split, strictly enforced:**

- The CLI contains no knowledge of modes, field names, markdown, or editorial concepts.
- The skill contains no knowledge of HTTP, JSON:API envelope details, or auth mechanics.
- Mode markdowns are the single source of truth for "how content of target X is shaped".

## 6. Editorial Workflow

A typical invocation:

1. Editor asks the skill to publish `article-xyz.md`.
2. Skill reads the markdown (frontmatter + body).
3. Skill runs `drupal-cli discover` and `drupal-cli schema …` as needed to understand the live site.
4. Skill determines the target mode:
   - if frontmatter has `target:`, use it;
   - otherwise propose one based on content and discovery, confirm with editor.
5. Skill loads the matching mode markdown (e.g. `modes/canvas.md`) as its playbook.
6. Skill checks for existing content by calling `drupal-cli search` with the derived title. The result drives an interactive decision:
   - no match → create;
   - exact match → ask "update or create new?";
   - ambiguous matches → show a shortlist, editor picks.
7. Skill performs semantic mapping (Claude + mode markdown):
   - derives title, body, summary from markdown;
   - identifies media (markdown image syntax);
   - resolves taxonomy terms (existing or new);
   - asks the editor to fill any required field that could not be inferred.
8. Skill shows the planned payload as a human-readable summary (not raw JSON), the editor confirms or corrects.
9. Skill orchestrates writes via the CLI in the necessary order:
   - upload media files;
   - create any missing taxonomy terms;
   - create or update the primary entity (moderation state defaults to published);
   - set path alias and metatags.
10. Skill reports the result (URL, UUID, status).
11. On successful create, the skill asks the editor whether to write the returned metadata (UUID, canonical URL, path alias) back into the markdown frontmatter. **Opt-in per document**, no auto-write.

**Default moderation state:** When the skill is invoked directly (not in dry-run), new/updated content is published. `status: draft` in frontmatter overrides this.

**Interactive gates:** Mode choice, identity decision, payload preview, metadata write-back. No other automatic confirmations — the skill should not become chatty.

## 7. CLI Surface

All commands emit JSON on stdout, errors on stderr with non-zero exit codes.

```
drupal-cli discover [--refresh]
  → Full picture of the target site: Drupal version,
    installed modules, entity types/bundles/fields,
    Canvas components, Display Builder templates,
    moderation workflows.

drupal-cli schema <entity_type>/<bundle> [--for=create|update]
  → JSON Schema (Draft 2020-12) describing the valid
    JSON:API payload for the given entity/bundle.

drupal-cli search <entity_type>
     [--bundle=<bundle>] [--filter=<key>:<value>]…
     [--limit=N]
  → Array of matching resources (uuid, type, bundle,
    attributes summary).

drupal-cli read <entity_type>/<uuid>
  → Full JSON:API response for the resource.

drupal-cli create <entity_type> --bundle=<bundle>
     --data=<json|@file>
  → Created resource (JSON:API response).

drupal-cli update <entity_type>/<uuid>
     --data=<json|@file>
  → Updated resource.

drupal-cli delete <entity_type>/<uuid>
  → { "ok": true }

drupal-cli upload-file
     --target=<entity_type>/<uuid>/<field_name>
     --file=<path>
     [--alt=…] [--title=…]
  → { file_uuid, media_uuid? }

drupal-cli clean
  → Removes .drupal-cli/cache/* to force fresh discovery.
```

**Shared flags:**

- `--profile=<name>` (reserved for future multi-site; currently only one profile in the config)
- `--dry-run` — print the payload, do not send
- `--refresh` — force re-fetch instead of cache read (on `discover`, `schema`)

**Explicitly NOT in the CLI:**

- No mode-specific commands (`canvas-write`, `node-publish`, …). Mapping lives in the skill.
- No `publish` / `moderate` command. Moderation state is just a field on an update call.
- No taxonomy-specific commands. Terms are entities like any other.

## 8. Discovery + JSON Schema

### 8.1 Discovery

`drupal-cli discover` returns a single JSON document describing the target site.
Shape (abridged):

```json
{
  "drupal": { "version": "11.x.y", "base_url": "…" },
  "installed_modules": ["jsonapi", "canvas", "display_builder", "media", "…"],
  "entity_types": {
    "node": {
      "bundles": {
        "article": {
          "label": "Article",
          "fields": {
            "title":   { "type": "string", "required": true, "max_length": 255 },
            "body":    { "type": "text_with_summary", "required": false },
            "field_tags": {
              "type": "entity_reference",
              "target_type": "taxonomy_term",
              "target_bundles": ["tags"],
              "cardinality": -1
            },
            "field_image": {
              "type": "entity_reference",
              "target_type": "media",
              "target_bundles": ["image"],
              "cardinality": 1
            }
          }
        }
      }
    },
    "taxonomy_term": { "bundles": { "tags": { "…": "…" } } },
    "media":         { "bundles": { "image": { "…": "…" } } }
  },
  "features": {
    "canvas": {
      "available_components": [
        { "id": "hero",       "fields": { "…": "…" } },
        { "id": "text_block", "fields": { "…": "…" } }
      ],
      "page_bundle": "canvas_page"
    },
    "display_builder": {
      "available_templates": [
        { "id": "landing_hero_cta" },
        { "id": "two_column_article" }
      ],
      "page_bundle": "landing_page"
    },
    "content_moderation": {
      "workflows": { "editorial": { "states": ["draft", "published", "archived"] } }
    },
    "pathauto": { "enabled": true },
    "metatag":  { "enabled": true }
  }
}
```

### 8.2 Sources of discovery data

- **Entity types / bundles / fields:** JSON:API index + schema endpoints.
- **Installed modules, Canvas components, Display Builder templates:** companion Drupal module `drupal_cli_info` exposing `/drupal-cli/info` (JSON). The module is one `composer require` away and is installed by the test fixture.
- **Moderation workflows:** `drupal_cli_info` provides a compact summary of Workflow config entities.

Rationale: relying purely on JSON:API for Canvas/Display Builder metadata is fragile. A tiny companion module is pragmatic and stable.

### 8.3 JSON Schema generation

`drupal-cli schema <entity_type>/<bundle>` derives a JSON Schema from discovery so the skill can:

- Ask Claude to produce schema-conformant payloads (reduces hallucination of field names).
- Validate locally (via Ajv) before calling `create`/`update`. Missing required fields become a dialog with the editor, not a 422 round-trip.

Schema-generation mapping (Drupal field type → JSON Schema fragment) is table-driven. Relationship shapes are centralised in `$defs` so every reference of the same target reuses one fragment.

Separate `--for=create` vs `--for=update` outputs differ in which fields are required (update allows partial payloads).

### 8.4 Caching

- Discovery and schema responses are cached in `.drupal-cli/cache/`.
- No TTL. Cache stays until the user runs `drupal-cli clean` or deletes the directory.
- `--refresh` on a single call bypasses the cache for that call only.

## 9. Mode Markdowns

Each mode markdown is a plain-text playbook Claude reads when publishing to a particular target. Shape is a convention, not enforced.

```markdown
---
name: canvas
description: Publish mode for Drupal Canvas pages
applies_when: |
  - frontmatter target: canvas
  - or discovery.installed_modules includes "canvas" AND the content
    has several distinct sections/columns
---

# Mode: canvas

## Preconditions
- discovery.installed_modules contains "canvas"
- Target entity/bundle: node/<discovery.features.canvas.page_bundle>

## Required fields
- title (from H1 or frontmatter.title)
- canvas_tree (structured, see below)
- status (default: 1 / published when invoked directly)

## Mapping rules
1. Title: H1 or frontmatter.title.
2. Each H2 becomes a Canvas section.
3. Content between H2s maps to Canvas components; the catalogue of
   available components comes from
   discovery.features.canvas.available_components.
   Ambiguous content → ask the editor.
4. Markdown images are uploaded first, then referenced by the
   appropriate component field.
5. Tags in frontmatter → taxonomy_term search/create.

## Payload skeleton (example)
```json
{
  "data": {
    "type": "node--canvas_page",
    "attributes": { "title": "…", "status": true },
    "relationships": { "canvas_tree": { "…": "…" } }
  }
}
```

## Post-steps
- Set path alias (from frontmatter.slug or derived from title).
- Set metatags (from frontmatter.meta).
```

**Mode markdowns shipped in the MVP:**

- `modes/node.md` — classic node with fixed fields.
- `modes/canvas.md` — Drupal Canvas page.
- `modes/display_builder.md` — Display Builder landing page.

**Shared mechanics** (how to call the CLI, how to read discovery output, how to conduct rich dialogs with the editor, how to validate payloads) live in the top-level skill markdown, not in each mode.

**Adding a new mode:**

1. Drop `modes/<new-mode>.md` into the skill repo.
2. Add its `applies_when:` trigger.
3. The skill picks it up automatically on next invocation.

No CLI change, no core skill change.

## 10. Config & Auth

Per-project file `.drupal-cli.yml` at the repo root.

```yaml
site:
  base_url: https://my-drupal.example.com
  jsonapi_prefix: /jsonapi
  auth:
    type: oauth2_password
    client_id: ${DRUPAL_CLIENT_ID}
    client_secret: ${DRUPAL_CLIENT_SECRET}
    username: ${DRUPAL_USER}
    password: ${DRUPAL_PASSWORD}

defaults:
  dry_run: false
  timeout_ms: 30000
```

**Supported `auth.type` values (MVP):**

- `basic` — username + password via HTTP Basic
- `oauth2_password` — Simple OAuth, password grant, token cached under `~/.cache/drupal-cli/tokens.json`
- `oauth2_client_credentials` — service accounts

> **History:** JWT and API-Key adapters were removed on 2026-04-22 because editorial workflows did not use them. See `docs/superpowers/specs/2026-04-22-integration-tests-design.md` §2.

**`${ENV}` expansion:** The CLI substitutes `${VAR}` references at load time. Missing variables are a loud error, not a silent skip.

**Cascading config:** Not in the MVP. One project, one config. `profiles:` block + `--profile` flag can be added later without breaking changes.

**Gitignore expectation:** `.drupal-cli.yml` is safe to commit because secrets are env references only. The actual secrets live in `.env` (gitignored) or the shell.

## 11. Content Identity

No UUID in frontmatter by default, no sidecar state file. The skill resolves identity via title search at invocation time.

**Flow:**

1. Determine a title candidate (frontmatter.title or H1).
2. Call `drupal-cli search <entity_type> --bundle=<b> --filter=title:<title>`.
3. Interpret results:
   - zero → create;
   - exact single match → ask "update existing or create new?";
   - ambiguous → show shortlist with title, path, changed date; editor picks.
4. On update: `read` current state, show a human-readable diff, validate payload against `schema --for=update`, call `update`.
5. On create: validate against `schema --for=create`, call `create`, offer metadata write-back.

**Optional frontmatter overrides:**

```yaml
identity:
  match: exact           # exact | fuzzy | none
  field: title           # which field to match on
  on_duplicate: ask      # ask | update | create | fail
```

Defaults: `match: exact`, `field: title`, `on_duplicate: ask`.

## 12. Error handling & Dry-run

### 12.1 CLI errors

- Non-zero exit code on every failure.
- Structured error on stderr:
  `{"error": {"code": "…", "message": "…", "details": { … }}}`.
- Drupal's JSON:API error envelope is passed through in `details`.
- Retry only for transient failures (network timeouts, 502/503): up to 3 attempts with exponential backoff. Never retry on 4xx.

### 12.2 Skill reactions

| Situation                              | Skill response                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Local schema validation fails          | Do not send. Ask the editor for the missing/invalid fields, patch the payload, re-validate.           |
| Auth error                             | Abort. Explain which credentials to check in which profile.                                           |
| 4xx from Drupal                        | Present error details to the editor, ask how to proceed (fix field, abort, skip).                     |
| 5xx / network error                    | CLI retries internally. Final failure → inform editor, abort subsequent steps for that document.      |
| Partial success across multiple writes | Summarise what succeeded and what did not, list resulting UUIDs, let the editor choose next action.   |

**No automatic rollback.** Editorial dialog owns recovery decisions.

### 12.3 Dry-run

- Editor command "show the plan" or frontmatter `dry_run: true` activates dry-run mode.
- All read-only CLI calls (`discover`, `schema`, `search`, `read`) run normally.
- All write calls (`create`, `update`, `delete`, `upload-file`) are invoked with `--dry-run`, so the CLI returns the payload it would have sent and a synthetic response.
- The skill presents the complete plan (per entity: operation, fields, references, files) and asks for confirmation.
- On confirmation, the skill re-executes the same sequence without `--dry-run`.
- Idempotence between the two passes is **not** guaranteed in the MVP: if another editor races in between, the second pass may hit the normal `on_duplicate: ask` gate. Acceptable given the interactive nature.

## 13. Testing

### 13.1 CLI unit tests (Vitest)

Fast, Drupal-free:

- Config loader: YAML parsing, `${ENV}` expansion, failure modes.
- Auth adapters: correct request shape per auth type.
- Schema generator: Drupal field type → JSON Schema fragment (table-driven).
- CLI argument parsing: `--filter=title:foo` → correct JSON:API URL query.

### 13.2 Integration tests against DDEV Drupal

- Live Drupal 11 instance brought up by DDEV in `tests/integrations/drupal/`.
- Fixture scripts install the required modules for the CLI MVP, create the `article_test` content type, create OAuth2 consumers, and provision a dedicated test editor user.
- Tests exercise `read`, `search`, `create`, `upload-file`, `update`, and `delete` and assert both CLI response and live Drupal state.

### 13.3 Skill dry-run snapshot tests

- Fixture markdowns in `tests/fixtures/editorial/` cover scenarios (article→node, landing→canvas, landing→display_builder, update path, title-conflict path, missing-required-field path).
- Runner invokes the orchestration in dry-run mode, snapshots the sequence of planned CLI calls, and diffs against stored snapshots.
- Pure CLI-call sequences, no LLM in CI loop. The deterministic portion of the skill (mode selection heuristics, payload assembly, validation handling) is extracted into testable functions.
- Optional: an offline "explain the plan" run with Claude, kept out of CI.

### 13.4 End-to-end

- Golden-path scenarios documented in `docs/e2e/` for manual validation before release.
- Scripted headless E2E is a post-MVP nice-to-have.

## 14. DDEV setup (worktree-aware)

The test Drupal must support multiple git worktrees running in parallel without port or name collisions.

**Layout:**

```
tests/integrations/drupal/
  .ddev/
    config.yaml          # committed, no hard-coded project name
  fixtures/
    setup-content-type.php
    setup-oauth.php
    setup-users.php
  composer.json          # Drupal 11 + contrib modules
```

**Worktree-safety measures:**

- **Dynamic project name.** `config.yaml` does not set `name:`. `bin/ddev-up.sh` computes a unique name (e.g. `drupal-cli-test-<short-sha-or-path-hash>`) and writes it into `.ddev/config.local.yaml` (gitignored).
- **Unique URL.** Test URL is `https://<dynamic-name>.ddev.site`. The script exports `DRUPAL_CLI_TEST_URL`; tests read only this variable.
- **Free ports.** No `router_http_port`/`router_https_port` in `config.yaml`. DDEV picks free ports per project.
- **Isolated DB volumes.** Automatic per project name; no extra work.
- **Relative paths only.** Setup scripts use `$PWD`/`dirname $0`, never absolute paths.
- **Clean teardown.** `bin/ddev-down.sh` removes the per-worktree DDEV project so `git worktree remove` leaves no residue.
- **CI parallelism.** In GitHub Actions, the name incorporates `$GITHUB_RUN_ID` (or falls back to a random hash) so concurrent jobs do not collide.
- **Fresh caches.** Composer/Drush caches are per-worktree. Small overhead on first start, zero cross-contamination.

**Developer DX:**

- `npm run test:e2e` wraps `ddev-up.sh` → fixtures → tests → `ddev-down.sh`.
- `npm run drupal:up` / `npm run drupal:down` for interactive use.

## 15. Project layout (proposed)

```
drupal-cli/
  CLAUDE.md
  README.md
  package.json
  tsconfig.json
  src/
    index.ts                  # CLI entrypoint
    commands/
      discover.ts
      schema.ts
      search.ts
      read.ts
      create.ts
      update.ts
      delete.ts
      upload-file.ts
      clean.ts
    core/
      config.ts               # .drupal-cli.yml loader + env expansion
      http.ts                 # fetch wrapper with retry
      auth/
        basic.ts
        oauth2.ts
      jsonapi/
        client.ts             # low-level GET/POST/PATCH/DELETE
        query.ts              # filter builder
      schema/
        generate.ts           # discovery → JSON Schema
        validate.ts           # Ajv wrapper
      cache/
        store.ts              # .drupal-cli/cache file-backed store
  skill/
    drupal-cli.md             # main skill (orchestration, CLI usage, dialog patterns)
    modes/
      node.md
      canvas.md
      display_builder.md
  drupal-module/
    drupal_cli_info/          # companion module
      drupal_cli_info.info.yml
      src/Controller/InfoController.php
      drupal_cli_info.routing.yml
  tests/
    unit/                     # Vitest for CLI
    integration/              # against DDEV Drupal
    fixtures/
      editorial/              # scenario markdowns
    drupal/                   # DDEV project (see §14)
  docs/
    superpowers/
      specs/
        2026-04-21-drupal-cli-design.md   # this file
    e2e/                      # manual E2E scripts
```

## 16. Extensibility principles

- **New target mode:** add one file `skill/modes/<mode>.md`. No code change.
- **New field type the schema generator has not met yet:** extend the mapping table in `core/schema/generate.ts` (pure data, single file).
- **New auth mechanism:** drop a new file into `core/auth/`, add its `type` to the config schema, register it in the auth factory.
- **New discovery source (e.g. another Drupal-side module):** extend the companion module or the discover command's aggregator; the CLI surface stays the same.
- **Project-local overrides to mode markdowns:** not in the MVP. A later cascade (project `./modes/` overrides skill `modes/`) is a straightforward addition if needed.

## 17. Out of scope / future

- Paragraphs and Layout Builder modes
- Multi-target profiles (dev/stage/prod) in one config
- Automated rollback of partial writes
- Translations and revisions handling
- A scheduler or file-watcher driving invocations automatically
- Project-local mode-markdown cascade
