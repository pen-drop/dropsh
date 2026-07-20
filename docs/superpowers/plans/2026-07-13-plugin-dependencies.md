# Plugin-declared dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a dropsh plugin declare further plugins it depends on, which dropsh resolves, orders, de-duplicates, and cycle-checks into the same flat plugin list.

**Architecture:** Add an optional `dependencies?: PluginDescriptor[]` runtime field to `DropSHPlugin`. Turn `resolvePlugins` in `src/core/config.ts` from a flat `map` into a post-order DFS that expands each plugin's declared dependencies before the plugin itself, dedups by resolved module path + export (and by plugin id), throws on cycles, and resolves a child descriptor relative to its declaring plugin's module first.

**Tech Stack:** Node.js ESM, TypeScript, vitest. `node:module` `createRequire`, `node:url` `pathToFileURL`.

## Global Constraints

- All artifacts in English (identifiers, comments, commit messages) — `CLAUDE.md`.
- Import-free config: descriptors name a package as a string; the config imports nothing — `src/core/config.ts` docblock.
- Backward compat: a pre-constructed `DropSHPlugin` object in `plugins[]` still passes through unchanged.
- Node `>=20`.
- Before committing the final task: `pnpm run lint && pnpm run typecheck && pnpm test` all pass.

## File Structure

- `src/core/plugin.ts` — add `PluginDescriptor` type + `dependencies?` field. Owns the plugin contract.
- `src/core/config.ts` — recursive `resolvePlugins`; reuse `PluginDescriptor`. Owns config loading + plugin graph expansion.
- `tests/unit/core/config.test.ts` — extend with dependency/dedup/cycle/order tests.
- `tests/unit/fixtures/config/` — new fixture plugin modules + config files.
- `plugins/tui/src/index.ts` — declare `@dropsh/plugin-markdown` as a dependency.

---

### Task 1: `PluginDescriptor` type + `dependencies` field

**Files:**
- Modify: `src/core/plugin.ts`
- Modify: `src/core/config.ts:29-31` (reuse the type in `isPluginDescriptor`)

**Interfaces:**
- Produces: `export interface PluginDescriptor { plugin: string; with?: unknown; options?: unknown; export?: string }` and `DropSHPlugin.dependencies?: PluginDescriptor[]`.

- [ ] **Step 1: Add the type + field to `src/core/plugin.ts`**

Add near the top of the file (after the imports):

```ts
/**
 * Import-free descriptor naming a plugin package as a string. Same shape used
 * by the top-level `plugins[]` config; a plugin returns these in `dependencies`
 * to have dropsh auto-load further plugins.
 */
export interface PluginDescriptor {
  plugin: string;
  with?: unknown;
  options?: unknown;
  export?: string;
}
```

Add the field inside `DropSHPlugin`, after `requiredModules`:

```ts
  /**
   * Plugins this plugin depends on. dropsh resolves each descriptor and inserts
   * the resulting plugin into the flat plugin list *before* this plugin, so a
   * dependency's renderers / schema hooks are available when this plugin runs.
   * De-duplicated across the whole graph; cycles are rejected at config load.
   */
  dependencies?: PluginDescriptor[];
```

- [ ] **Step 2: Reuse the type in `src/core/config.ts`**

Import it and narrow `isPluginDescriptor` to it. Change the import line:

```ts
import type { DropSHPlugin, PluginDescriptor } from "./plugin.js";
```

Replace `isPluginDescriptor` (lines 29-31):

```ts
function isPluginDescriptor(e: unknown): e is PluginDescriptor {
  return isRecord(e) && typeof e.plugin === "string";
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS (no behavior change yet).

- [ ] **Step 4: Commit**

```bash
git add src/core/plugin.ts src/core/config.ts
git commit -m "feat(plugin): add PluginDescriptor type + dependencies field"
```

---

### Task 2: Recursive dependency resolution

Rewrite `resolvePlugins` and factor descriptor resolution out of `loadNamedPlugin`. This task carries the full behavior + its tests.

**Files:**
- Modify: `src/core/config.ts:40-91` (`loadNamedPlugin`, `resolvePlugins`)
- Test: `tests/unit/core/config.test.ts`
- Create fixtures under `tests/unit/fixtures/config/`:
  - `dep-parent.mjs`, `dep-child.mjs`
  - `dep-a.mjs`, `dep-b.mjs` (cycle a↔b)
  - `dep-diamond-*.mjs` (a→b, a→c, b→d, c→d)
  - `deps-basic.js`, `deps-cycle.js`, `deps-diamond.js`, `deps-missing.js` (config files)

**Interfaces:**
- Consumes: `PluginDescriptor` (Task 1), `isPluginDescriptor`, `ConfigError`.
- Produces: `resolvePlugins(raw: unknown, configPath: string): Promise<DropSHPlugin[]>` — now flattens the dependency graph, deps first, deduped, cycle-checked.
- Internal: `resolveDescriptor(entry: PluginDescriptor, bases: string[], declaredBy: string | undefined): Promise<{ plugin: DropSHPlugin; resolvedPath: string; exportName: string }>`.

- [ ] **Step 1: Write the failing tests**

Add these fixtures first.

`tests/unit/fixtures/config/dep-child.mjs`:
```js
export function makeChild(opts = {}) {
  return { id: opts.id ?? "child", requiredModules: [] };
}
export default makeChild;
```

`tests/unit/fixtures/config/dep-parent.mjs`:
```js
export function makeParent(opts = {}) {
  return {
    id: opts.id ?? "parent",
    requiredModules: [],
    dependencies: [{ plugin: "./dep-child.mjs", export: "makeChild" }],
  };
}
export default makeParent;
```

`tests/unit/fixtures/config/deps-basic.js`:
```js
export default {
  site: { base_url: "https://example.com" },
  plugins: [{ plugin: "./dep-parent.mjs", export: "makeParent" }],
};
```

`tests/unit/fixtures/config/dep-a.mjs`:
```js
export default function makeA() {
  return { id: "a", requiredModules: [], dependencies: [{ plugin: "./dep-b.mjs" }] };
}
```

`tests/unit/fixtures/config/dep-b.mjs`:
```js
export default function makeB() {
  return { id: "b", requiredModules: [], dependencies: [{ plugin: "./dep-a.mjs" }] };
}
```

`tests/unit/fixtures/config/deps-cycle.js`:
```js
export default {
  site: { base_url: "https://example.com" },
  plugins: [{ plugin: "./dep-a.mjs" }],
};
```

`tests/unit/fixtures/config/dep-diamond-d.mjs`:
```js
export default function makeD() {
  return { id: "d", requiredModules: [] };
}
```

`tests/unit/fixtures/config/dep-diamond-b.mjs`:
```js
export default function makeB() {
  return { id: "b", requiredModules: [], dependencies: [{ plugin: "./dep-diamond-d.mjs" }] };
}
```

`tests/unit/fixtures/config/dep-diamond-c.mjs`:
```js
export default function makeC() {
  return { id: "c", requiredModules: [], dependencies: [{ plugin: "./dep-diamond-d.mjs" }] };
}
```

`tests/unit/fixtures/config/dep-diamond-a.mjs`:
```js
export default function makeA() {
  return {
    id: "a",
    requiredModules: [],
    dependencies: [{ plugin: "./dep-diamond-b.mjs" }, { plugin: "./dep-diamond-c.mjs" }],
  };
}
```

`tests/unit/fixtures/config/deps-diamond.js`:
```js
export default {
  site: { base_url: "https://example.com" },
  plugins: [{ plugin: "./dep-diamond-a.mjs" }],
};
```

`tests/unit/fixtures/config/deps-missing.js`:
```js
export default {
  site: { base_url: "https://example.com" },
  plugins: [{ plugin: "./dep-parent-missing.mjs", export: "make" }],
};
```

`tests/unit/fixtures/config/dep-parent-missing.mjs`:
```js
export function make() {
  return {
    id: "parent-missing",
    requiredModules: [],
    dependencies: [{ plugin: "@dropsh/definitely-not-installed" }],
  };
}
```

Now the tests, appended inside the existing `describe("loadConfig", ...)` in `tests/unit/core/config.test.ts`:

```ts
it("auto-loads a declared dependency, ordered before its declarer", async () => {
  const cfg = await loadConfig(fixture("deps-basic.js"));
  expect(cfg.plugins.map((p) => p.id)).toEqual(["child", "parent"]);
});

it("loads a shared dependency once (diamond graph)", async () => {
  const cfg = await loadConfig(fixture("deps-diamond.js"));
  const ids = cfg.plugins.map((p) => p.id);
  expect(ids.filter((id) => id === "d")).toHaveLength(1);
  // d before b and c; b and c before a
  expect(ids.indexOf("d")).toBeLessThan(ids.indexOf("b"));
  expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("a"));
  expect(ids.indexOf("c")).toBeLessThan(ids.indexOf("a"));
});

it("rejects a dependency cycle with the chain", async () => {
  await expect(loadConfig(fixture("deps-cycle.js"))).rejects.toThrow(ConfigError);
  await expect(loadConfig(fixture("deps-cycle.js"))).rejects.toThrow(/dep-a\.mjs.*dep-b\.mjs.*dep-a\.mjs/s);
});

it("names the declaring parent when a dependency cannot be resolved", async () => {
  await expect(loadConfig(fixture("deps-missing.js"))).rejects.toThrow(
    /definitely-not-installed.*declared by/s,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- config`
Expected: FAIL — the new tests error (current `resolvePlugins` ignores `dependencies`, so `deps-basic` yields only `["parent"]`, etc.).

- [ ] **Step 3: Implement the recursive resolver**

Replace `loadNamedPlugin` (lines 40-75) and `resolvePlugins` (lines 82-91) in `src/core/config.ts` with:

```ts
async function resolveDescriptor(
  entry: PluginDescriptor,
  bases: string[],
  declaredBy: string | undefined,
): Promise<{ plugin: DropSHPlugin; resolvedPath: string; exportName: string }> {
  const name = entry.plugin;
  let resolved: string | undefined;
  for (const base of bases) {
    try {
      resolved = createRequire(base).resolve(name);
      break;
    } catch {
      // try the next base
    }
  }
  if (resolved === undefined) {
    const from = declaredBy ? ` (declared by '${declaredBy}')` : "";
    throw new ConfigError(
      `cannot resolve plugin '${name}'${from}. Install it next to dropsh (project dep, dropsh dep, global next to a global dropsh, or 'npx -p dropsh -p ${name}').`,
    );
  }

  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
  } catch (err) {
    throw new ConfigError(`cannot load plugin '${name}'`, { cause: String(err) });
  }
  const exportName = typeof entry.export === "string" ? entry.export : "default";
  const factory = mod[exportName];
  if (typeof factory !== "function")
    throw new ConfigError(`plugin '${name}' has no callable export '${exportName}'`);
  const plugin = (factory as (opts?: unknown) => DropSHPlugin)(entry.with ?? entry.options);
  return { plugin, resolvedPath: resolved, exportName };
}

/**
 * Expands `plugins[]` into a flat plugin list: named-package descriptors are
 * resolved + built, and each built plugin's `dependencies` are expanded
 * *before* it (post-order DFS). A plugin is emitted once — dedup by resolved
 * module path + export for descriptors, by `id` for the final list — and a
 * dependency cycle is rejected with the offending chain. Pre-constructed plugin
 * objects pass through unchanged (backward compat).
 */
async function resolvePlugins(raw: unknown, configPath: string): Promise<DropSHPlugin[]> {
  if (!Array.isArray(raw)) return [];

  const baseBases = [
    pathToFileURL(configPath).href,
    pathToFileURL(`${process.cwd()}/`).href,
    import.meta.url,
  ];
  const out: DropSHPlugin[] = [];
  const doneKeys = new Set<string>(); // resolvedPath::export — fully expanded
  const doneIds = new Set<string>(); // plugin.id already emitted
  const stack: string[] = []; // descriptor names on the current DFS path

  const emit = (plugin: DropSHPlugin): void => {
    if (doneIds.has(plugin.id)) return;
    doneIds.add(plugin.id);
    out.push(plugin);
  };

  const expandDeps = async (plugin: DropSHPlugin, bases: string[]): Promise<void> => {
    for (const dep of plugin.dependencies ?? []) await expand(dep, bases, plugin.id);
  };

  async function expand(
    entry: unknown,
    bases: string[],
    declaredBy: string | undefined,
  ): Promise<void> {
    if (!isPluginDescriptor(entry)) {
      // Pre-constructed plugin object: expand its deps first, then emit it.
      const plugin = entry as DropSHPlugin;
      await expandDeps(plugin, bases);
      emit(plugin);
      return;
    }

    const { plugin, resolvedPath, exportName } = await resolveDescriptor(entry, bases, declaredBy);
    const key = `${resolvedPath}::${exportName}`;
    if (doneKeys.has(key)) return; // already expanded + emitted
    if (stack.includes(entry.plugin))
      throw new ConfigError(
        `plugin dependency cycle: ${[...stack, entry.plugin].join(" → ")}`,
      );

    stack.push(entry.plugin);
    // Child descriptors resolve relative to this plugin's module first.
    const childBases = [pathToFileURL(resolvedPath).href, ...baseBases];
    await expandDeps(plugin, childBases);
    stack.pop();

    doneKeys.add(key);
    emit(plugin);
  }

  for (const entry of raw) await expand(entry, baseBases, undefined);
  return out;
}
```

Note: the cycle guard uses `entry.plugin` (the descriptor name) for a readable chain; the dedup key uses the resolved path so two names for the same file still dedup.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- config`
Expected: PASS — all new tests plus the existing config tests green.

- [ ] **Step 5: Full check + commit**

```bash
pnpm run lint && pnpm run typecheck && pnpm test
git add src/core/config.ts tests/unit/core/config.test.ts tests/unit/fixtures/config
git commit -m "feat(config): resolve plugin-declared dependencies (DROPSH-8)"
```

---

### Task 3: tui declares markdown

**Files:**
- Modify: `plugins/tui/src/index.ts`
- Test: `tests/unit/plugins-integration.test.ts`

**Interfaces:**
- Consumes: `dependencies` field (Task 1), recursive resolver (Task 2).

- [ ] **Step 1: Inspect the tui plugin export**

Run: `sed -n '1,40p' plugins/tui/src/index.ts`
Confirm the exported factory returns a `DropSHPlugin` object literal and note whether it imports the markdown renderer directly today.

- [ ] **Step 2: Add the dependency declaration**

In the object returned by the tui plugin factory, add:

```ts
    dependencies: [{ plugin: "@dropsh/plugin-markdown" }],
```

(Alongside `id` / `requiredModules`.) Keep any direct markdown-render import used at runtime; the declaration is what makes dropsh load the markdown plugin's renderers into the shared list.

- [ ] **Step 3: Write the integration test**

Add to `tests/unit/plugins-integration.test.ts`:

```ts
it("tui declares the markdown plugin as a dependency", () => {
  const tui = tuiPlugin();
  expect(tui.dependencies).toEqual([{ plugin: "@dropsh/plugin-markdown" }]);
});
```

Add the import at the top:

```ts
import { default as tuiPlugin } from "../../plugins/tui/src/index.js";
```

Adjust the import name/shape to the tui package's actual export (verify in Step 1 — it may be a named export rather than default).

- [ ] **Step 4: Run tests**

Run: `pnpm test -- plugins-integration`
Expected: PASS.

- [ ] **Step 5: Full check + commit**

```bash
pnpm run lint && pnpm run typecheck && pnpm test
git add plugins/tui/src/index.ts tests/unit/plugins-integration.test.ts
git commit -m "feat(tui): declare markdown plugin dependency (DROPSH-8)"
```

---

## Self-Review

- **Spec coverage:** AC-1 → Task 2 `deps-basic` test + Task 3. AC-2 → descriptor form used in every fixture (incl. `with`/`export` in `dep-parent`). AC-3 → diamond test. AC-4 → cycle test. AC-5 → deps land in the same flat list emitted by `resolvePlugins`, verified by ordering test. Missing-dependency error → `deps-missing` test.
- **Placeholder scan:** none — every code step shows the code.
- **Type consistency:** `PluginDescriptor` (Task 1) is consumed by `isPluginDescriptor`, `resolveDescriptor`, and `dependencies` (Tasks 2-3); `resolveDescriptor` return shape `{ plugin, resolvedPath, exportName }` matches its callers.

## Verification note

Task 3 Step 1/3 assume details of `plugins/tui/src/index.ts` (default vs named export, whether markdown is imported directly). The implementer must open that file and adapt the import + declaration placement to what is actually there.
