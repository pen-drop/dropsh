# Render Formats & Views Design

**Date:** 2026-07-03
**Status:** Approved (brainstorming)

## Problem

Every dropsh command emits JSON to stdout. The skill layer consumes that
JSON, but a human operator has no readable way to view JSON:API entities in
the terminal, and there is no path to render entities as Markdown or to browse
them interactively.

We want a pluggable **render layer**: a JSON:API document (single entity or a
collection) can be rendered in a chosen format via `--format <id>`, and an
interactive TUI can browse entities. Everything beyond the built-in `json`
format ships as a plugin, consistent with dropsh's existing plugin
architecture (`@dropsh/plugin-oauth2`, `@dropsh/plugin-schemata`).

## Goals

- A `Renderer` extension point on `DrupalCliPlugin`, selected by a global
  `--format <id>` flag.
- `json` stays the built-in default → full backward compatibility; the skill
  keeps seeing JSON.
- Ship three base plugins: `@dropsh/plugin-markdown` (detail view),
  `@dropsh/plugin-table` (list view), `@dropsh/plugin-tui` (interactive browse).
- Keep the core entity-agnostic: no field-name or Markdown knowledge is
  hard-wired in core.

## Non-Goals

- No template engine in this iteration. A data-driven template renderer
  (e.g. `@dropsh/plugin-template` on eta) can be added later as a separate
  plugin — the `Renderer` contract already supports it (YAGNI).
- No entity editing from the TUI in this phase — browse is read-only.
- No specialized/hard-coded per-bundle renderers in core; those are plugins.

## Architecture

Two extension points, both on the existing `DrupalCliPlugin` interface:

1. **Renderer API (new, declarative).** A plugin exposes `renderers?:
   Renderer[]`. A renderer is `{ id, render(doc, ctx) → string }`. The global
   `--format <id>` flag selects one. `json` is a core built-in and the default.

2. **Interactive renderer (new, declarative).** A plugin exposes a renderer
   with `interactive: true` and `run(doc, ctx) → Promise<void>` instead of
   `render(doc, ctx) → string`, because a full-screen event loop does not fit
   the `render() → string` contract. `--format tui` selects it exactly like
   any other format — `read`/`search` stay the only entry commands, there is
   no separate `browse` command. The TUI detail pane reuses the Markdown
   renderer.

The renderer receives the **whole document** — single (`data: {}`) or
collection (`data: []`) — plus a `RenderContext`. It decides single-vs-list
layout itself.

Three new workspace packages under `plugins/`, each with its own
`package.json`, `tsconfig.json`, `vitest.config.ts`, mirroring the existing
`plugins/oauth2` and `plugins/schemata` layout. Activated via `plugins: [...]`
in `dropsh.config.js`.

## Types

### JSON:API domain types (general)

New file `src/core/jsonapi/types.ts` — these belong to the JSON:API layer, not
the render layer, and are reused across the codebase:

```ts
export interface JsonApiResource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
  links?: Record<string, unknown>;
}
export interface JsonApiDocument {
  data: JsonApiResource | JsonApiResource[];
  included?: JsonApiResource[];
  meta?: Record<string, unknown>;
  links?: Record<string, unknown>;
}
```

`src/core/jsonapi/client.ts` is tightened: `get`/`post`/`patch` return
`Promise<JsonApiDocument>` instead of `unknown`. `delete`/`upload` keep their
`{ ok: true }`-style acknowledgements (not documents). This is a net win beyond
the render feature — the codebase gains real types instead of `unknown`.

### Render types (render-specific)

New file `src/core/cli/render.ts`:

```ts
import type { JsonApiDocument } from "../jsonapi/types.js";

export interface RenderContext {
  command: "read" | "search" | "create" | "update";
  target?: string;      // "node/article/uuid" or "node"
  entityType?: string;
  bundle?: string;
}
export interface Renderer {
  readonly id: string;                              // "md", "table"
  render(doc: JsonApiDocument, ctx: RenderContext): string;
}
export interface InteractiveRenderer {
  readonly id: string;                              // "tui"
  readonly interactive: true;
  run(doc: JsonApiDocument, ctx: RenderContext): Promise<void>;
}
export type AnyRenderer = Renderer | InteractiveRenderer;
export function isInteractive(r: AnyRenderer): r is InteractiveRenderer;
```

### Plugin interface

`src/core/plugin.ts` gains one optional line, importing `AnyRenderer` from
`render.ts`:

```ts
renderers?: AnyRenderer[];
```

## Core changes

- **`--format <id>`**: global option on the program, default `json`.
- **Renderer registry**: `createOutput` receives `{ format, renderers }`. The
  registry is `{ json: builtinJson, ...pluginRenderers }`; the `json` built-in
  is today's `JSON.stringify` behaviour.
- **Scope**: `--format` applies only to entity-emitting commands — `read`,
  `search`, `create`, `update`. These route through a typed path that, for a
  non-`json` format, calls the selected renderer with the `JsonApiDocument`.
  The renderer is guaranteed a document — no `unknown`, no crash fallback.
- **Always-json commands** (not entities): `delete` (`{ ok: true }`),
  `upload-file`, `schema` (JSON Schema / catalog). Passing `--format=md` to one
  of these is a `ConfigError` (exit 2): `format 'md' not applicable to command
  'schema'`.
- **`emit` signature** becomes `emit(value, ctx?)`; existing callers without
  `ctx` keep working. The `run()` wrapper in `index.ts` builds the
  `RenderContext` (command name + parsed target parts) and passes it.
- **Unknown `--format` id** → `ConfigError` (exit 2) at startup, before any
  HTTP, listing available ids.

## Base plugins

### `@dropsh/plugin-markdown` — detail view

- Registers renderer `id: "md"`. Entity-agnostic.
- Single resource → YAML frontmatter from scalar `attributes`
  (string/number/bool) plus `type`/`id`. Body = heuristic: field `body`
  (`.value`/`.processed`) if present, else the longest string field, else
  empty. Relationships → frontmatter list `rel: [type/id, …]`.
- Collection (`data: []`) → multiple Markdown blocks separated by `\n\n---\n\n`.
- Dumb by design: no hard-wired field names, only heuristics. Specialized views
  are separate renderer plugins with their own `id`.

### `@dropsh/plugin-table` — list view

- Registers renderer `id: "table"`.
- Collection → aligned ASCII box table. Columns: `id` plus the first scalar
  attributes (preferring `title`/`name`/`status` when present); long values
  truncated.
- Single resource → 2-column key/value table.
- No external dependency — its own column-width calculator (~50 lines).

### `@dropsh/plugin-tui` — interactive format

- Registers an `InteractiveRenderer` with `id: "tui"`, selected via
  `--format tui` on `read`/`search` — no separate `browse` command. `read`
  and `search` stay the only entry commands; presentation is chosen entirely
  via `--format`.
- Flow: `read --format tui` fetches the single entity and boots straight
  into the detail pane. `search --format tui` fetches the collection and
  shows a list (arrow/Enter navigation) → detail pane. The detail pane
  renders via the **md renderer** (the plugin depends on
  `@dropsh/plugin-markdown` and reuses its `render`), so `--include` embeds
  related resources in the detail pane exactly as it does for `--format md`.
- UI library `ink` (React-based, TS standard, testable via
  `ink-testing-library`), isolated in this package's `package.json`. Core stays
  dependency-free.
- Read-only first phase (browse/view). Editing is future work.
- Phase-1 renders the detail pane as Markdown only; `detailRenderer` is
  reserved for a later phase and has no effect yet.

#### TUI configuration

Configured through its factory `tuiPlugin(opts)` in `dropsh.config.js`:

```ts
interface TuiViewConfig {
  entityType: string;                 // "node"
  bundle?: string;                    // "article" — optional match
  columns?: string[];                 // list columns, attr paths
  filters?: Record<string, string>;   // default JSON:API filters for the view
  detailRenderer?: string;            // renderer id for the detail pane, default "md"
  pageSize?: number;
}
interface TuiOptions {
  views?: TuiViewConfig[];
  defaultPageSize?: number;           // global, default 25
  detailRenderer?: string;            // global default "md"
}
```

Resolution: `dropsh search node --bundle article --format tui` finds the
matching `TuiViewConfig` (entityType [+ bundle]) and uses its
columns/filters/renderer. No match → heuristic (id + title/name/status, md
detail). Specialized displays and filters are thus data-driven per entity
type without code. For true custom rendering, write a renderer plugin and
reference its `id` as `detailRenderer`.

### Example config

```js
import { markdownPlugin } from '@dropsh/plugin-markdown';
import { tablePlugin } from '@dropsh/plugin-table';
import { tuiPlugin } from '@dropsh/plugin-tui';

export default {
  // …site/defaults…
  plugins: [
    markdownPlugin(),
    tablePlugin(),
    tuiPlugin({
      defaultPageSize: 25,
      views: [
        { entityType: "node", bundle: "article",
          columns: ["title", "status", "changed"],
          filters: { status: "1" },
          detailRenderer: "md" },
        { entityType: "media", columns: ["name", "field_media_image"] },
      ],
    }),
  ],
};
```

## Error handling & edge cases

- Unknown `--format` → `ConfigError` (exit 2) at startup, before HTTP; message
  lists available ids.
- `--format` on a non-entity command (`delete`/`upload-file`/`schema`) →
  `ConfigError` (exit 2), `format 'md' not applicable to 'schema'`.
- `fail()` always emits JSON to stderr, regardless of format — errors stay
  machine-readable; the skill error path is unchanged.
- A renderer that throws goes through `fail()` → JSON error on stderr, non-zero
  exit. Renderer failures never contaminate stdout with partial output.
- Empty collection (`data: []`): md → empty string / `_(no results)_`; table →
  header + `(0 rows)`. No crash.
- md heuristic finds no body → frontmatter only, empty body. Legitimate.
- TUI without a TTY (pipe/CI): `--format tui` detects `!process.stdout.isTTY`
  and raises `ConfigError` `--format tui requires an interactive terminal`.
  No hang.
- `included`: renderers may use it (relationship resolution) but must work
  without it.

## Testing

- **Core** (`tests/unit`): format resolution, default `json`, unknown format →
  exit 2, non-entity command + `--format` → exit 2, `emit` backward compat. The
  existing `contextFactory`/`stdout`/`stderr` injection makes this fully
  in-memory testable.
- **plugin-markdown**: single → frontmatter+body, collection → blocks, body
  heuristic, empty collection, relationships. Pure function tests (doc in,
  string out).
- **plugin-table**: column selection, alignment/truncation, single key/value,
  0 rows.
- **plugin-tui**: `ink-testing-library` — list renders rows, Enter → detail
  pane, non-TTY → error. Smoke level (interactive UI is hard to fully cover).
- Each plugin package has its own `vitest.config.ts`, mirroring
  `oauth2`/`schemata`.
- No CI integration test needed (no live DDEV — pure transform logic).

## Backward compatibility

Default `--format=json` reproduces today's exact output. `emit(value)` with no
`ctx` still works. No consumer of dropsh JSON is affected unless a non-json
format is explicitly requested.
