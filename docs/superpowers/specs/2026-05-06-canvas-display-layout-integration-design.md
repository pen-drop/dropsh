# Canvas / Display Builder / Layout Builder Integration

**Date:** 2026-05-06  
**Status:** Approved

## 1. Goal

Integrate three Drupal page-building systems into the dropsh editorial workflow:

- **Canvas** — block-based visual editor, component tree stored as a JSON string field
- **Display Builder** — flexible variant of Canvas; multiple fields per entity can each carry a UI-patterns component tree
- **Layout Builder** — Drupal core layout system, sections + blocks

All three follow the same CLI principle: the CLI stays entity-agnostic, no new Canvas/Display Builder/Layout Builder specific commands. The component tree is just a field value in a standard `create`/`update` payload. The skill layer (mode markdowns) owns the mapping from editorial content to the correct JSON shape.

## 2. Approach: Research-Spike first, then three implementation worktrees

```
spike/jsonapi-research
  └── docs/research/2026-05-06-component-tree-jsonapi-findings.md
        ↓
feat/canvas          feat/display-builder          feat/layout-builder
  spec + plan          spec + plan                   spec + plan
  discover cmd         discover cmd (extend)         discover cmd (extend)
  modes/canvas.md      modes/display_builder.md      modes/layout_builder.md
  integration tests    integration tests             integration tests
```

Implementation worktrees are sequential: each waits for the previous merge before starting, because `discover` is built up incrementally.

## 3. Spike worktree (`spike/jsonapi-research`)

### 3.1 Purpose

Hands-on exploration of real JSON:API responses from all three modules running in DDEV. No production code, no assertions — pure discovery.

### 3.2 DDEV fixture changes

Extend `tests/integrations/drupal/composer.json` to add:
- `drupal/canvas` (exact package name to be confirmed on drupal.org)
- `drupal/display_builder` (exact package name to be confirmed on drupal.org)
- Layout Builder is Drupal core — no extra package needed

Add setup scripts (alongside existing fixtures):
- `tests/integrations/drupal/fixtures/setup-canvas.php` — enable Canvas module, create a canvas_page bundle, define a few test components
- `tests/integrations/drupal/fixtures/setup-display-builder.php` — enable Display Builder, create a landing_page bundle

### 3.3 Exploration scripts

Plain Node.js/TypeScript scripts under `tests/integrations/explore/` — not test files, no Vitest assertions. They run against the live DDEV instance and print raw JSON:API responses.

One script per question:

```
tests/integrations/explore/
  canvas-jsonapi-index.ts        # what does /jsonapi list for canvas entities?
  canvas-create-page.ts          # create a canvas page, inspect the response shape
  canvas-component-types.ts      # where do available component types come from?
  display-builder-index.ts       # same for display builder
  display-builder-create-page.ts
  display-builder-component-types.ts
  layout-builder-index.ts        # same for layout builder
  layout-builder-section-types.ts
```

Run via:
```bash
node --import tsx/esm tests/integrations/explore/canvas-jsonapi-index.ts
```

### 3.4 Questions the spike must answer

For each system (Canvas, Display Builder, Layout Builder):

| Question | Canvas | Display Builder | Layout Builder |
|---|---|---|---|
| JSON:API endpoint(s) for page entities? | | | |
| Exact field name(s) for the component tree? | | | |
| JSON shape of one component entry? | | | |
| Source of available component/section types? | | | |
| Contrib module that extends JSON:API support? | | | |
| Full example create payload? | | | |
| Full example update payload? | | | |

**Source priority for available component types:**
1. Module's own JSON:API endpoint
2. Existing contrib module
3. Neither found → document as blocker, inform developer — **no custom companion module**

### 3.5 Output

`docs/research/2026-05-06-component-tree-jsonapi-findings.md` — filled-in findings table with real JSON examples from DDEV responses. This document drives all three subsequent specs.

## 4. `discover` command

Not yet implemented. Canvas worktree delivers it first; Display Builder and Layout Builder worktrees extend it.

### 4.1 Invocation

```bash
dropsh discover [--refresh]
```

Cached at `.dropsh/cache/discover.json`. `--refresh` bypasses cache.

### 4.2 Output shape (to be validated by spike)

```json
{
  "drupal": { "version": "11.x.y", "base_url": "…" },
  "installed_modules": ["canvas", "display_builder", "…"],
  "entity_types": { "…": "…" },
  "features": {
    "canvas": {
      "page_bundle": "canvas_page",
      "available_components": [
        { "id": "hero",       "fields": { "…": "…" } },
        { "id": "text_block", "fields": { "…": "…" } }
      ]
    },
    "display_builder": {
      "page_bundle": "landing_page",
      "available_components": [
        { "id": "hero_cta", "fields": { "…": "…" } }
      ]
    },
    "layout_builder": {
      "enabled_bundles": ["landing_page"],
      "available_sections": ["…"]
    },
    "content_moderation": {
      "workflows": { "editorial": { "states": ["draft", "published"] } }
    }
  }
}
```

The exact shapes under `features.canvas`, `features.display_builder`, and `features.layout_builder` are determined by the spike findings — particularly whether available components come from the module's own JSON:API or a contrib module.

## 5. Implementation worktrees

### 5.1 Canvas (`feat/canvas`)

**Prerequisite:** spike findings document complete.

**Deliverables:**
- `src/commands/discover.ts` — `discover` command, Canvas section populated
- `modes/canvas.md` — mode markdown: H2 → Canvas section, content → component mapping, component catalogue from `discover` output
- DDEV fixture: Canvas module installed + test canvas page
- Integration tests: `dropsh discover` returns Canvas components, `dropsh create` with canvas payload succeeds

### 5.2 Display Builder (`feat/display-builder`)

**Prerequisite:** Canvas worktree merged.

**Deliverables:**
- Extend `src/commands/discover.ts` — Display Builder section added
- `modes/display_builder.md` — mode markdown: mapping editorial content onto multiple UI-pattern fields; component catalogue from `discover`
- DDEV fixture: Display Builder module installed + test landing page
- Integration tests: `dropsh discover` returns Display Builder components, create/update with multi-field component tree succeeds

**Key difference from Canvas:** Display Builder can have multiple fields on a single entity, each carrying its own component tree. The mode markdown must handle which field gets which content.

### 5.3 Layout Builder (`feat/layout-builder`)

**Prerequisite:** Display Builder worktree merged.

**Deliverables:**
- Extend `src/commands/discover.ts` — Layout Builder section added
- `modes/layout_builder.md` — mode markdown
- Integration tests
- No DDEV fixture changes (Layout Builder is core)

**Note:** Layout Builder's JSON:API exposure is limited in core. The spike determines whether an existing contrib module is required. If nothing usable exists, this worktree is blocked — no custom module.

## 6. No custom companion module

The original design planned a `dropsh_info` Drupal companion module. That is **removed** from this design.

Discovery data must come from:
1. The module's own JSON:API support
2. An existing contrib module

If neither provides what `discover` needs, the gap is documented and the developer is informed. No custom Drupal module is built.

## 7. Mode markdown structure (preview)

Each mode markdown lives in `modes/` and follows this convention:

```markdown
---
name: canvas
applies_when:
  - frontmatter target: canvas
  - or discovery.installed_modules includes "canvas"
    AND content has multiple distinct sections
---

## Preconditions
- discovery.features.canvas is present
- Target bundle: discovery.features.canvas.page_bundle

## Mapping rules
1. Title: H1 or frontmatter.title
2. Each H2 → one Canvas section
3. Content between H2s → component from discovery.features.canvas.available_components
4. Images → upload-file first, then reference by component field
5. Tags → taxonomy_term search/create

## Payload skeleton
{ "data": { "type": "node--canvas_page", "attributes": { "title": "…", "canvas_tree": [ … ] } } }
```

Display Builder mode markdown adds: logic for mapping content across multiple component-tree fields.

## 8. Success criteria

- `dropsh discover` returns accurate component catalogues for all installed systems
- `dropsh create` with a Canvas/Display Builder payload succeeds end-to-end in DDEV
- Mode markdowns enable the skill to publish a markdown document to Canvas and Display Builder without manual JSON editing
- No custom Drupal module shipped
