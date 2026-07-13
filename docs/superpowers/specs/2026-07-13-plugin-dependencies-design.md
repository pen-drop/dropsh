# Plugin-declared dependencies (DROPSH-8)

## Problem

dropsh plugins are loaded only from the top-level `plugins[]` config as
import-free descriptors (`{ plugin, with?, export? }`) or as already-constructed
`DropSHPlugin` objects. `resolvePlugins` maps the array one-to-one: no
dependency resolution, no dedup, no ordering guarantees.

When a plugin needs another plugin's capability, the operator must list both in
`plugins[]` in the right order. Concretely, `@dropsh/plugin-tui` renders through
`@dropsh/plugin-markdown` (already a real npm dependency of the tui package), yet
the config must name both and put markdown first. That couples plugin internals
to end-user config and breaks silently when a dependency is missing or misordered.

## Goal

A plugin declares the further plugins it depends on. dropsh resolves those
dependencies, inserts them into the same flat plugin list the rest of the CLI
already consumes, de-duplicates, and detects cycles. Dependencies use the same
import-free descriptor form as `plugins[]`, so nothing about the committed config
changes shape.

## Design

### 1. Interface — `src/core/plugin.ts`

Add one optional field to `DropSHPlugin`:

```ts
dependencies?: PluginDescriptor[];
```

`PluginDescriptor` is the descriptor shape already used by `plugins[]`:
`{ plugin: string; with?: unknown; options?: unknown; export?: string }`. It is
promoted to an exported type so plugin authors can type their `dependencies`
array. The field is a **runtime field**: the plugin factory runs and returns an
instance that carries its dependency descriptors; dropsh loads those afterwards.
Dependencies are additive — they are never injected back into the declaring
plugin.

### 2. Resolution — `src/core/config.ts`

`resolvePlugins` becomes a recursive graph expansion that flattens the plugin
graph into the flat `DropSHPlugin[]` returned today.

For each `plugins[]` entry:

1. Resolve + construct the plugin. Descriptors go through `loadNamedPlugin`
   (which already knows the resolved module path); already-constructed instances
   pass through unchanged (backward compat).
2. Read the constructed instance's `dependencies` descriptors and expand each
   recursively.
3. Emit dependencies **before** the plugin that declared them (post-order DFS),
   so a dependency's renderers / schema hooks are registered before the declaring
   plugin relies on them (e.g. markdown before tui).

**Dedup.** A descriptor is de-duplicated by its **resolved package path +
`export`**, checked *before* construction — so a plugin named by two different
parents is resolved and its factory called once. Already-constructed instances
and the final flattened list are additionally de-duplicated by `id` as a
safety net.

**Cycle detection.** The DFS carries the set of descriptors currently on the
resolution stack (keyed by resolved path + export). Re-entering one is a cycle;
dropsh throws a `ConfigError` naming the chain, e.g. `a → b → a`.

**Child resolution base.** A dependency declared by a plugin is resolved
relative to the **declaring plugin's module first**, then the existing bases
(config dir → cwd → dropsh install). This matches the npm model: a plugin's
dependency is its own installed npm dependency (tui ships markdown in its own
`node_modules`), so the operator installs only the top-level plugin.

### 3. Consumer change

`@dropsh/plugin-tui` gains:

```ts
dependencies: [{ plugin: "@dropsh/plugin-markdown" }]
```

The operator then lists only `{ plugin: "@dropsh/plugin-tui" }` in `plugins[]`;
markdown is pulled in automatically, ahead of tui.

### 4. Error handling

- **Missing dependency:** the existing `loadNamedPlugin` "cannot resolve
  plugin '<name>'" `ConfigError` is raised, extended to name the parent plugin
  that declared it, so the operator knows where the dependency came from.
- **Cycle:** `ConfigError` with the full chain.
- Both fail the config load loudly; there is no silent skip.

## Acceptance criteria

- **AC-1:** A plugin can declare dependent plugins, and dropsh loads them
  automatically when that plugin is activated.
- **AC-2:** Declared dependencies use the same import-free descriptor form
  (`{ plugin, with, export? }`) as the top-level `plugins[]` config.
- **AC-3:** A plugin already loaded (top-level or via another dependency) is
  loaded once; duplicates are de-duplicated, not re-initialized.
- **AC-4:** Circular dependencies between plugins are detected and reported with
  a clear error instead of hanging or crashing.
- **AC-5:** Dependency-loaded plugins participate in the same lifecycle hooks
  (render / schema / auth) as top-level plugins — guaranteed by construction,
  since they land in the same flat plugin list.

## Testing

Unit tests in `tests/` (or `src/core/*.test.ts`, matching existing layout)
against `resolvePlugins` / `loadConfig` with fixture plugin modules:

- dependency auto-loaded and ordered before its declarer (AC-1, AC-5).
- descriptor form honored for a dependency, incl. `with` and `export` (AC-2).
- diamond graph (a → b, a → c, b → d, c → d) loads `d` once (AC-3).
- cycle (a → b → a) throws `ConfigError` naming the chain (AC-4).
- missing dependency throws `ConfigError` naming the declaring parent.

## Out of scope

- On-demand / lazy loading (load a plugin only when its capability is first
  used). This ticket is declared-dependency auto-loading only.
- Version constraints between plugins. Dependencies are named, not versioned;
  npm resolution owns the version.
