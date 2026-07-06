# TUI Entity Router — Design

**Status:** Approved (design)
**Date:** 2026-07-04
**Worktree:** `.claude/worktrees/tui` (branch `worktree-tui`)
**Supersedes the ad-hoc rendering in:** `plugins/tui/src/browse-app.tsx`

## Problem

The current TUI (`@dropsh/plugin-tui`) is an opaque renderer: `read`/`search`
fetch a JSON:API document, `--format tui` hands it to an Ink app that renders a
flat list plus a markdown-string detail pane. It cannot:

- render an entity differently per **view mode** (Drupal `default`/`teaser`/…),
- **navigate** from one entity to a related one (relationship fields are inert
  text in an opaque markdown string),
- be **extended per content type** by independently published packages.

## Goal

Re-model the TUI on Drupal's own display + routing architecture:

| Drupal | TUI |
|---|---|
| `EntityViewBuilder` + view modes | `TuiEntityView` — renders **one** entity in a view mode |
| `EntityListBuilder` | `TuiEntityList` — renders a collection |
| Routing (`entity.node.canonical`, path → controller, param upcasting) | `TuiRoute` + router — navigation is a route history stack |

Two **decoupled** layers: a standalone router, and per-type entity handlers. A
route belongs to no entity; its controller may load an entity and dispatch to
the registered handler for that type.

## Packaging

- **All TUI logic lives in `@dropsh/plugin-tui`**: router, browse host, base
  classes (`TuiEntityView`, `TuiEntityList`), `TuiLink`, the `TuiRoute` type,
  the registry, the generic default handler, and the `tuiPlugin({ plugins })`
  factory. These are **exported** from the package.
- **Sub-plugins are real, separately published npm packages** (e.g.
  `@dropsh/plugin-tui-article`) that declare `@dropsh/plugin-tui` as a
  peer dependency, import the base classes, extend them, and export a
  `TuiSubPlugin`.
- `DrupalCliPlugin` is **not** extended. The tui plugin owns its own plugin
  system.

### This pass builds: framework only

`@dropsh/plugin-tui` with the router, base classes, host, default routes, and
the generic default handler. No concrete sub-plugin package is built here —
they come later as independent packages, proving the exported API.

## Architecture

### tuiPlugin factory + sub-plugins

```ts
interface TuiSubPlugin {
  id: string;
  entities?: TuiEntityHandlerClass[];   // e.g. [ArticleView, ArticleList]
  routes?: TuiRoute[];                   // optional, standalone routes
}

// usage in dropsh.config.js
tuiPlugin({ plugins: [articleTuiPlugin /* @dropsh/plugin-tui-article */] })
```

At construction, `tuiPlugin` aggregates the `entities` and `routes` of all its
sub-plugins, adds the core default routes and the generic default handler, and
builds the registry + route table. No host-side aggregation is required.

### Layer 1 — Router (standalone, knows no entities)

```ts
interface TuiRoute {
  name: string;        // "entity.canonical"
  path: string;        // "/{type}/{bundle}/{id}" — template with params
  controller: TuiController;
}
```

- **Core default routes** (registered by `@dropsh/plugin-tui`):
  - `entity.canonical` — path `/{type}/{bundle}/{id}`. Controller upcasts the
    entity, looks up the `TuiEntityView` for `type`/`bundle` (or the generic
    default handler), renders it in the requested view mode.
  - `entity.collection` — path `/{type}` (optionally `/{type}/{bundle}`).
    Controller renders the `TuiEntityList` (or the generic default list).
- Sub-plugins add free-standing routes via `routes`.
- **Router runtime**: a history stack. `navigate(name, params)` matches a
  route, **upcasts** any entity-bound param — fetching via the injected
  `client` with the target view mode's `include` hints — and renders the
  controller's element. `Esc`/`q` pops the stack; popping the last entry exits.
- **Upcasting** = the Drupal param-conversion analogue: a route param bound to
  an entity (e.g. `{node}` → an id) becomes a loaded `JsonApiResource` before
  the controller runs. Handlers are fetch-free.

### Layer 2 — Entity handlers (per type, metadata on the class)

```ts
abstract class TuiEntityView {
  static entityType: string;                 // "node"
  static bundle?: string;                     // "article" (optional)
  static viewModes: Record<string, { include?: string[] }>;
  abstract build(entity: JsonApiResource, ctx: BuildContext): ReactElement;
}

abstract class TuiEntityList {
  static entityType: string;
  static bundle?: string;
  abstract build(resources: JsonApiResource[], ctx: BuildContext): ReactElement;
}

interface BuildContext {
  viewMode: string;
  doc: JsonApiDocument;                        // includes `included`
  link: (route: string, params: Record<string, string>) => LinkDescriptor;
}
```

- Handlers own their layout — **no generic tab layout is imposed**.
- The static metadata is the registration: `entities: [ArticleView, ArticleList]`.
  The registry keys on `${entityType}:${bundle ?? ""}`.
- **Links**: a handler renders `<TuiLink route params>label</TuiLink>` around
  navigable fields (typically relationship targets). The browse host collects
  all rendered `TuiLink`s, makes them focusable (`↑`/`↓`), and on `Enter` calls
  the router's `navigate(route, params)`.

### Generic default handler

`@dropsh/plugin-tui` ships a built-in `TuiEntityView`/`TuiEntityList` used when
no sub-plugin is registered for a type. It renders raw fields (attributes as
label/value, relationships as `TuiLink`s), so the TUI is useful out of the box
and relationships remain navigable. Sub-plugins only refine.

### Injection (sole core touch, additive)

- `InteractiveRenderer.run(doc, ctx, services)` gains a third parameter.
- `services = { client: JsonApiClient; baseUrl: string }`.
- The host (`src/index.ts`, where `output` is created / `emit` is called)
  threads `CommandContext.client` and `baseUrl` through `output.emit` into
  `run`.
- Pure string renderers (`md`, `table`) ignore `services` — unchanged.
- The registry and router are **internal** to `@dropsh/plugin-tui`; nothing
  TUI-specific leaks into `RenderContext` or `DrupalCliPlugin`.

### CLI + initial route

- New global flag `--view-mode <name>` on `read`/`search` → `RenderContext.viewMode`
  (default `"default"`).
- `read node/article/X --view-mode teaser` → the app boots by navigating to
  `entity.canonical` with `{type:node, bundle:article, id:X}`, **seeding the
  already-fetched `doc`** into the router cache (no double fetch), rendered in
  the `teaser` view mode.
- `search node/article` → boots at `entity.collection`, seeding the fetched
  collection document.

## Data flow

```
read/search --view-mode teaser
  → doc fetched by command (existing path)
  → output.emit(doc, ctx)  [ctx.viewMode = "teaser"]
  → tui renderer.run(doc, ctx, { client, baseUrl })
  → <Browse> host: seed doc into router cache, navigate initial route
       ├─ controller upcasts (cache hit for seeded doc) → handler.build()
       ├─ host renders element, collects <TuiLink>s, manages focus
       └─ Enter on a link → router.navigate(route, params)
             → upcast: client.get(type/bundle/id, {include: viewMode hints})
             → push onto history stack → render target handler
             → Esc → pop (empty stack → exit)
```

## Module boundaries (within `@dropsh/plugin-tui`)

- `src/router.ts` — route table, matching, upcasting, history stack, `navigate`.
- `src/entity-view.ts` / `src/entity-list.ts` — abstract base classes + the
  generic default handlers.
- `src/link.tsx` — `TuiLink` component + focus collection contract.
- `src/browse-app.tsx` — the Ink host: wires router, focus, keybindings.
- `src/registry.ts` — builds the registry + route table from `TuiSubPlugin`s.
- `src/index.ts` — `tuiPlugin({ plugins })` factory, exports, `run()`.
- `src/types.ts` — `TuiSubPlugin`, `TuiRoute`, `TuiController`, `BuildContext`,
  `LinkDescriptor`, handler class types.

## Out of scope (YAGNI)

- Actions/keybindings per view mode (edit/delete/custom).
- In-app view-mode switching (view mode is fixed per CLI invocation).
- Live-fetching Drupal's `entity_view_display` config; view modes are declared
  in code by the handlers.
- Route access control / permissions / requirements.
- Concrete sub-plugin packages (built later, separately).

## Testing

- `router`: route matching, param upcasting (mock client), history push/pop,
  seeded-doc cache hit avoids re-fetch.
- `registry`: aggregation of sub-plugin `entities`/`routes`, key resolution
  `type:bundle` → `type:` fallback → generic default handler.
- Handlers/host: `ink-testing-library` — `lastFrame()` assertions on rendered
  view modes, focus movement across `TuiLink`s, `Enter` triggers `navigate`.
- Generic default handler renders raw fields and navigable relationships.
