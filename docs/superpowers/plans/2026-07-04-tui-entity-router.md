# TUI Entity Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-model `@dropsh/plugin-tui` as a Drupal-style entity router: a standalone route layer plus per-type entity handlers (`TuiEntityView`/`TuiEntityList`), with a generic default handler so the TUI works without sub-plugins and relationships are navigable.

**Architecture:** Two decoupled layers inside `@dropsh/plugin-tui`. A router owns a route table + history stack and upcasts entity-bound route params by fetching via an injected JSON:API client. Entity handlers are abstract base classes carrying static metadata (`entityType`/`bundle`/`viewModes`); sub-plugins (future, separate npm packages) extend them and are passed into `tuiPlugin({ plugins })`. The only core change is threading a `{ client, baseUrl }` services object into interactive renderers plus a `--view-mode` flag.

**Tech Stack:** TypeScript (ESM, NodeNext), Ink 5 + React 18 (JSX `react-jsx`), vitest + ink-testing-library, commander.

## Global Constraints

- All artifacts in **English** (code, identifiers, comments, help text, commit messages).
- Every commit must pass `npm run lint`, `npm run typecheck`, `npm test`.
- ESM imports use `.js` extensions (NodeNext), even for `.tsx` sources (import `./link.js`).
- All terminal text must be inside Ink `<Text>`; layout via `<Box>`. No raw strings as JSX children outside `<Text>`.
- **`DrupalCliPlugin` must NOT be extended.** The tui plugin owns its own plugin system via `tuiPlugin({ plugins })`.
- **All TUI logic lives in `@dropsh/plugin-tui`** and is exported for future sub-plugin packages.
- Scope: **framework only**. No concrete sub-plugin package is built.
- Out of scope (do not implement): per-view-mode actions/keybindings, in-app view-mode switching, live-fetch of Drupal display config, route access control.

## File Structure

Core (`src/`):
- `core/cli/render.ts` — add `RenderServices`, extend `InteractiveRenderer.run` signature, add `RenderContext.viewMode`.
- `core/cli/output.ts` — thread `services` through `emit` into `run`.
- `plugin-api.ts` — re-export `RenderServices`.
- `index.ts` — `--view-mode` flag, `viewMode` on read/search `rctx`, build + pass `services`.

Package (`plugins/tui/src/`):
- `types.ts` — `TuiSubPlugin`, `TuiRoute`, `TuiController`, `BuildContext`, `LinkDescriptor`, `ViewModeMap`, handler class types.
- `link.tsx` — `TuiLink` component + `FocusRegistry` context (collects navigable targets).
- `entity-view.tsx` — `TuiEntityView` abstract base + `GenericEntityView` default.
- `entity-list.tsx` — `TuiEntityList` abstract base + `GenericEntityList` default.
- `registry.ts` — build registry from sub-plugins, resolve handler (`type:bundle` → `type:` → generic), build route table with core defaults.
- `router.ts` — history stack, `navigate`, upcasting via client, seeded-doc cache.
- `browse-app.tsx` — Ink host: wire router + focus + keybindings (rewrite of current file).
- `index.ts` — `tuiPlugin({ plugins })` factory + `run(doc, ctx, services)` (rewrite).

Removed: `plugins/tui/src/views.ts` and `plugins/tui/tests/unit/views.test.ts` (config-`views` model superseded by sub-plugins). The current `plugins/tui/tests/unit/browse-app.test.tsx` is rewritten in Task 8.

---

### Task 1: Core — services channel + viewMode on RenderContext

**Files:**
- Modify: `src/core/cli/render.ts`
- Modify: `src/core/cli/output.ts`
- Modify: `src/plugin-api.ts`
- Test: `tests/unit/core/output.test.ts`

**Interfaces:**
- Produces: `RenderServices { client: JsonApiClient; baseUrl: string }`; `InteractiveRenderer.run(doc, ctx, services?): Promise<void>`; `RenderContext.viewMode?: string`; `Output.emit(value, ctx?, services?)`.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/core/output.test.ts` inside the `describe("createOutput", ...)` block:

```ts
it("passes services to an interactive renderer's run()", async () => {
  const c = collect();
  const run = vi.fn(async () => {});
  const tuiRenderer: InteractiveRenderer = { id: "tui", interactive: true, run };
  const o = createOutput({ ...c.push, renderers: [tuiRenderer], getFormat: () => "tui" });
  const services = { client: {} as never, baseUrl: "https://x.test" };
  await o.emit({ data: { type: "node--article", id: "u1" } }, { command: "read", viewMode: "teaser" }, services);
  expect(run).toHaveBeenCalledWith(
    { data: { type: "node--article", id: "u1" } },
    { command: "read", viewMode: "teaser" },
    services,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/core/output.test.ts -t "passes services"`
Expected: FAIL — `emit` ignores the 3rd arg / `run` called with 2 args.

- [ ] **Step 3: Edit `src/core/cli/render.ts`** — add the import, the services type, the `viewMode` field, and the new `run` signature:

```ts
import type { JsonApiClient } from "../jsonapi/client.js";
// ...existing indexIncluded...

export interface RenderContext {
  command: "read" | "search" | "create" | "update";
  target?: string;
  entityType?: string;
  bundle?: string;
  viewMode?: string;
}

export interface RenderServices {
  client: JsonApiClient;
  baseUrl: string;
}

export interface Renderer {
  readonly id: string;
  render(doc: JsonApiDocument, ctx: RenderContext): string;
}

export interface InteractiveRenderer {
  readonly id: string;
  readonly interactive: true;
  run(doc: JsonApiDocument, ctx: RenderContext, services?: RenderServices): Promise<void>;
}
```

- [ ] **Step 4: Edit `src/core/cli/output.ts`** — thread `services` through `emit`:

```ts
import { type AnyRenderer, isInteractive, type RenderContext, type RenderServices } from "./render.js";

export interface Output {
  emit(value: unknown, ctx?: RenderContext, services?: RenderServices): void | Promise<void>;
  fail(err: unknown): void;
  hasFormat(id: string): boolean;
}
```

In the returned object, change `emit(value, ctx)` to `emit(value, ctx, services)` and the interactive branch:

```ts
    emit(value, ctx, services) {
      const fmt = getFormat();
      if (fmt === "json" || !isJsonApiDocument(value)) {
        opts.stdout(`${JSON.stringify(value)}\n`);
        return;
      }
      const renderer = registry.get(fmt);
      if (!renderer) {
        throw new ConfigError(`Unknown format: ${fmt}`, { available: ["json", ...registry.keys()] });
      }
      if (isInteractive(renderer)) {
        return renderer.run(value, ctx ?? { command: "read" }, services);
      }
      const text = renderer.render(value, ctx ?? { command: "read" });
      opts.stdout(text.endsWith("\n") ? text : `${text}\n`);
    },
```

- [ ] **Step 5: Edit `src/plugin-api.ts`** — add `RenderServices` to the render type re-export block:

```ts
export type {
  AnyRenderer,
  InteractiveRenderer,
  RenderContext,
  Renderer,
  RenderServices,
} from "./core/cli/render.js";
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npx vitest run tests/unit/core/output.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/core/cli/render.ts src/core/cli/output.ts src/plugin-api.ts tests/unit/core/output.test.ts
git commit -m "feat(render): thread RenderServices + viewMode into interactive renderers"
```

---

### Task 2: CLI — `--view-mode` flag and services threading

**Files:**
- Modify: `src/index.ts` (global option ~55-56; `read` action 146-158; `search` action 168-184)
- Test: `tests/unit/index-format.test.ts`

**Interfaces:**
- Consumes: `Output.emit(value, ctx, services)` (Task 1); `CommandContext.client`, `CommandContext.baseUrl`.
- Produces: `read`/`search` set `rctx.viewMode` (from `--view-mode`, default `"default"`) and pass `{ client, baseUrl }` as `services` to `output.emit`.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/index-format.test.ts`:

```ts
it("passes viewMode and services to an interactive renderer via read", async () => {
  const run = vi.fn(async () => {});
  const tuiPluginStub: DrupalCliPlugin = {
    id: "tui-test",
    requiredModules: [],
    async extendSchema(_e, _b, s) { return s; },
    renderers: [{ id: "tui", interactive: true, run }],
  };
  const client = fakeClient();
  const out: string[] = [];
  const program = buildProgram({
    plugins: [tuiPluginStub],
    contextFactory: async () =>
      ({ client, baseUrl: "https://x.test", plugins: [tuiPluginStub] } as unknown as CommandContext),
    stdout: (s) => out.push(s),
    stderr: () => {},
    setExitCode: () => {},
  });
  await program.parseAsync(
    ["node", "dropsh", "--format", "tui", "--view-mode", "teaser", "read", "node/article/u1"],
  );
  expect(run).toHaveBeenCalledTimes(1);
  const [, ctx, services] = run.mock.calls[0];
  expect(ctx).toMatchObject({ command: "read", entityType: "node", bundle: "article", viewMode: "teaser" });
  expect(services).toMatchObject({ client, baseUrl: "https://x.test" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/index-format.test.ts -t "passes viewMode"`
Expected: FAIL — `run` receives no services / `viewMode` undefined.

- [ ] **Step 3: Add the global flag** in `src/index.ts` after the `--format` option (line 56):

```ts
    .option("--view-mode <name>", "entity view mode for interactive formats", "default");
```

- [ ] **Step 4: Thread viewMode + services in the `read` action** — replace the body from `const rctx` through the `return run(...)` (lines 148-158):

```ts
      const rctx: RenderContext = { command: "read", target };
      if (entityType !== undefined) rctx.entityType = entityType;
      if (bundle !== undefined) rctx.bundle = bundle;
      rctx.viewMode = program.opts().viewMode as string;
      // biome-ignore lint/suspicious/noExplicitAny: optional include added conditionally
      const args = { target } as any;
      const include = normalizeInclude(o.include);
      if (include.length > 0) args.include = include;
      return run(
        (ctx) =>
          runRead(args, {
            client: ctx.client,
            emit: (v) => output.emit(v, rctx, { client: ctx.client, baseUrl: ctx.baseUrl }),
          }),
        assertRenderable,
      );
```

- [ ] **Step 5: Thread viewMode + services in the `search` action** — replace the `rctx`/`return run(...)` block (lines 178-183):

```ts
        const rctx: RenderContext = { command: "search", entityType };
        if (o.bundle !== undefined) rctx.bundle = o.bundle;
        rctx.viewMode = program.opts().viewMode as string;
        return run(
          (ctx) =>
            runSearch(args, {
              client: ctx.client,
              emit: (v) => output.emit(v, rctx, { client: ctx.client, baseUrl: ctx.baseUrl }),
            }),
          assertRenderable,
        );
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npx vitest run tests/unit/index-format.test.ts tests/unit/index.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts tests/unit/index-format.test.ts
git commit -m "feat(cli): add --view-mode flag and pass client/baseUrl services to interactive renderers"
```

---

### Task 3: tui types + TuiLink focus primitive

**Files:**
- Create: `plugins/tui/src/types.ts`
- Create: `plugins/tui/src/link.tsx`
- Test: `plugins/tui/tests/unit/link.test.tsx`

**Interfaces:**
- Produces:
  - `types.ts`: `LinkDescriptor { route: string; params: Record<string, string> }`; `BuildContext { viewMode: string; doc: JsonApiDocument; link(route: string, params: Record<string, string>): LinkDescriptor }`; `ViewModeMap = Record<string, { include?: string[] }>`; `TuiRoute { name: string; path: string; controller: TuiController }`; `TuiController = (params: Record<string, string>, ctx: ControllerContext) => Promise<ReactElement>`; `ControllerContext { client: JsonApiClient; viewMode: string; seededDoc?: JsonApiDocument; navigate(route: string, params: Record<string, string>): void; resolveView(entityType: string, bundle?: string): EntityViewClass | undefined; resolveList(entityType: string, bundle?: string): EntityListClass | undefined; }`; `TuiSubPlugin { id: string; entities?: EntityHandlerClass[]; routes?: TuiRoute[] }`; plus the class-type aliases `EntityViewClass`, `EntityListClass`, `EntityHandlerClass` (declared as `unknown`-safe interfaces here, concretised in Tasks 4–5 via `import type`).
  - `link.tsx`: `FocusRegistryProvider`, `useFocusRegistry()`, `<TuiLink target={LinkDescriptor}>{label}</TuiLink>`. A `TuiLink` registers its `target` with the nearest `FocusRegistryProvider` on mount and renders its children inside `<Text inverse={isFocused}>`.

- [ ] **Step 1: Write the failing test** — `plugins/tui/tests/unit/link.test.tsx`:

```tsx
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { FocusRegistryProvider, TuiLink, useFocusRegistry } from "../../src/link.js";

function Probe() {
  const reg = useFocusRegistry();
  return (
    <>
      <TuiLink target={{ route: "entity.canonical", params: { id: "u1" } }}>Alpha</TuiLink>
      <TuiLink target={{ route: "entity.canonical", params: { id: "u2" } }}>Beta</TuiLink>
      {/* focus index 0 by default */}
      {reg.count() === 2 ? <></> : <></>}
    </>
  );
}

describe("TuiLink + FocusRegistry", () => {
  it("registers links and marks the focused one", () => {
    const { lastFrame } = render(
      <FocusRegistryProvider>
        <Probe />
      </FocusRegistryProvider>,
    );
    expect(lastFrame()).toContain("Alpha");
    expect(lastFrame()).toContain("Beta");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/tui && npx vitest run tests/unit/link.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `plugins/tui/src/types.ts`**:

```ts
import type { JsonApiClient, JsonApiDocument } from "dropsh/plugin";
import type { ReactElement } from "react";

export interface LinkDescriptor {
  route: string;
  params: Record<string, string>;
}

export interface BuildContext {
  viewMode: string;
  doc: JsonApiDocument;
  link(route: string, params: Record<string, string>): LinkDescriptor;
}

export type ViewModeMap = Record<string, { include?: string[] }>;

export interface ControllerContext {
  client: JsonApiClient;
  viewMode: string;
  seededDoc?: JsonApiDocument;
  navigate(route: string, params: Record<string, string>): void;
  resolveView(entityType: string, bundle?: string): EntityViewClass | undefined;
  resolveList(entityType: string, bundle?: string): EntityListClass | undefined;
}

export type TuiController = (
  params: Record<string, string>,
  ctx: ControllerContext,
) => Promise<ReactElement>;

export interface TuiRoute {
  name: string;
  path: string;
  controller: TuiController;
}

// Structural handler class shapes; concrete bases live in entity-view.tsx / entity-list.tsx.
export interface EntityViewClass {
  entityType: string;
  bundle?: string;
  viewModes: ViewModeMap;
  new (): { build(entity: import("dropsh/plugin").JsonApiResource, ctx: BuildContext): ReactElement };
}
export interface EntityListClass {
  entityType: string;
  bundle?: string;
  new (): { build(resources: import("dropsh/plugin").JsonApiResource[], ctx: BuildContext): ReactElement };
}
export type EntityHandlerClass = EntityViewClass | EntityListClass;

export interface TuiSubPlugin {
  id: string;
  entities?: EntityHandlerClass[];
  routes?: TuiRoute[];
}
```

- [ ] **Step 4: Create `plugins/tui/src/link.tsx`**:

```tsx
import { Text } from "ink";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { LinkDescriptor } from "./types.js";

interface FocusRegistry {
  register(target: LinkDescriptor): number;
  count(): number;
  focusedIndex: number;
  targetAt(i: number): LinkDescriptor | undefined;
}

const Ctx = createContext<FocusRegistry | null>(null);

export function useFocusRegistry(): FocusRegistry {
  const reg = useContext(Ctx);
  if (!reg) throw new Error("useFocusRegistry must be used within FocusRegistryProvider");
  return reg;
}

export function FocusRegistryProvider({
  focusedIndex = 0,
  children,
}: {
  focusedIndex?: number;
  children: React.ReactNode;
}): React.ReactElement {
  const targets = useRef<LinkDescriptor[]>([]);
  const [, force] = useState(0);
  targets.current = [];
  const reg: FocusRegistry = {
    register(target) {
      targets.current.push(target);
      return targets.current.length - 1;
    },
    count: () => targets.current.length,
    focusedIndex,
    targetAt: (i) => targets.current[i],
  };
  // Expose the live target list for the host via context; re-render on mount settle.
  useEffect(() => {
    force((n) => n + 1);
  }, []);
  return <Ctx.Provider value={reg}>{children}</Ctx.Provider>;
}

export function TuiLink({
  target,
  children,
}: {
  target: LinkDescriptor;
  children: React.ReactNode;
}): React.ReactElement {
  const reg = useFocusRegistry();
  const index = reg.register(target);
  const isFocused = index === reg.focusedIndex;
  return <Text inverse={isFocused}>{children}</Text>;
}
```

- [ ] **Step 5: Run test to verify pass**

Run: `cd plugins/tui && npx vitest run tests/unit/link.test.tsx && npx tsc --noEmit`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add plugins/tui/src/types.ts plugins/tui/src/link.tsx plugins/tui/tests/unit/link.test.tsx
git commit -m "feat(tui): add router/handler types and TuiLink focus primitive"
```

---

### Task 4: TuiEntityView base + generic default view

**Files:**
- Create: `plugins/tui/src/entity-view.tsx`
- Test: `plugins/tui/tests/unit/entity-view.test.tsx`

**Interfaces:**
- Consumes: `BuildContext`, `LinkDescriptor` (Task 3); `TuiLink` (Task 3).
- Produces: `abstract class TuiEntityView { static entityType: string; static bundle?: string; static viewModes: ViewModeMap; abstract build(entity: JsonApiResource, ctx: BuildContext): ReactElement }`; `class GenericEntityView extends TuiEntityView` — renders each attribute as `label: value` (`<Text>`), and each relationship whose `data` is a single ref as a `<TuiLink>` to `entity.canonical` with params `{ type, bundle, id }` derived from the JSON:API type `"<entityType>--<bundle>"`. `GenericEntityView.viewModes = { default: {} }`.

- [ ] **Step 1: Write the failing test** — `plugins/tui/tests/unit/entity-view.test.tsx`:

```tsx
import type { JsonApiDocument, JsonApiResource } from "dropsh/plugin";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { GenericEntityView } from "../../src/entity-view.js";
import { FocusRegistryProvider } from "../../src/link.js";

const link = (route: string, params: Record<string, string>) => ({ route, params });

function ctx(doc: JsonApiDocument) {
  return { viewMode: "default", doc, link };
}

describe("GenericEntityView", () => {
  it("renders attributes and a navigable relationship", () => {
    const entity: JsonApiResource = {
      type: "node--article",
      id: "u1",
      attributes: { title: "Alpha" },
      relationships: { uid: { data: { type: "user--user", id: "a1" } } },
    };
    const doc: JsonApiDocument = { data: entity };
    const el = new GenericEntityView().build(entity, ctx(doc));
    const { lastFrame } = render(<FocusRegistryProvider>{el}</FocusRegistryProvider>);
    expect(lastFrame()).toContain("title");
    expect(lastFrame()).toContain("Alpha");
    expect(lastFrame()).toContain("uid");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/tui && npx vitest run tests/unit/entity-view.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `plugins/tui/src/entity-view.tsx`**:

```tsx
import type { JsonApiResource } from "dropsh/plugin";
import { Box, Text } from "ink";
import React, { type ReactElement } from "react";
import { TuiLink } from "./link.js";
import type { BuildContext, ViewModeMap } from "./types.js";

export abstract class TuiEntityView {
  static entityType: string;
  static bundle?: string;
  static viewModes: ViewModeMap = { default: {} };
  abstract build(entity: JsonApiResource, ctx: BuildContext): ReactElement;
}

// Splits a JSON:API type "node--article" into { entityType: "node", bundle: "article" }.
function splitType(type: string): { entityType: string; bundle?: string } {
  const [entityType, bundle] = type.split("--");
  return bundle ? { entityType, bundle } : { entityType };
}

export class GenericEntityView extends TuiEntityView {
  static override entityType = "*";
  static override viewModes: ViewModeMap = { default: {} };

  build(entity: JsonApiResource, ctx: BuildContext): ReactElement {
    const attrs = entity.attributes ?? {};
    const rels = entity.relationships ?? {};
    return (
      <Box flexDirection="column">
        {Object.entries(attrs).map(([key, value]) => (
          <Text key={`a:${key}`}>
            {key}: {typeof value === "string" ? value : JSON.stringify(value)}
          </Text>
        ))}
        {Object.entries(rels).map(([key, rel]) => {
          const data = (rel as { data?: { type: string; id: string } }).data;
          if (!data || Array.isArray(data)) return <Text key={`r:${key}`}>{key}: —</Text>;
          const { entityType, bundle } = splitType(data.type);
          const params: Record<string, string> = { type: entityType, id: data.id };
          if (bundle) params.bundle = bundle;
          return (
            <Box key={`r:${key}`}>
              <Text>{key}: </Text>
              <TuiLink target={ctx.link("entity.canonical", params)}>{data.id}</TuiLink>
            </Box>
          );
        })}
      </Box>
    );
  }
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd plugins/tui && npx vitest run tests/unit/entity-view.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/tui/src/entity-view.tsx plugins/tui/tests/unit/entity-view.test.tsx
git commit -m "feat(tui): add TuiEntityView base and GenericEntityView default handler"
```

---

### Task 5: TuiEntityList base + generic default list

**Files:**
- Create: `plugins/tui/src/entity-list.tsx`
- Test: `plugins/tui/tests/unit/entity-list.test.tsx`

**Interfaces:**
- Consumes: `BuildContext` (Task 3); `TuiLink` (Task 3).
- Produces: `abstract class TuiEntityList { static entityType: string; static bundle?: string; abstract build(resources: JsonApiResource[], ctx: BuildContext): ReactElement }`; `class GenericEntityList extends TuiEntityList` — renders one `<TuiLink>` per resource to `entity.canonical` (params `{ type, bundle, id }` from the resource's JSON:API type), label = `attributes.title ?? attributes.name ?? id`; renders `<Text dimColor>(no results)</Text>` when empty.

- [ ] **Step 1: Write the failing test** — `plugins/tui/tests/unit/entity-list.test.tsx`:

```tsx
import type { JsonApiDocument, JsonApiResource } from "dropsh/plugin";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { GenericEntityList } from "../../src/entity-list.js";
import { FocusRegistryProvider } from "../../src/link.js";

const link = (route: string, params: Record<string, string>) => ({ route, params });

describe("GenericEntityList", () => {
  it("renders one navigable row per resource with a title label", () => {
    const rows: JsonApiResource[] = [
      { type: "node--article", id: "u1", attributes: { title: "Alpha" } },
      { type: "node--article", id: "u2", attributes: { title: "Beta" } },
    ];
    const doc: JsonApiDocument = { data: rows };
    const el = new GenericEntityList().build(rows, { viewMode: "default", doc, link });
    const { lastFrame } = render(<FocusRegistryProvider>{el}</FocusRegistryProvider>);
    expect(lastFrame()).toContain("Alpha");
    expect(lastFrame()).toContain("Beta");
  });

  it("shows (no results) for an empty collection", () => {
    const doc: JsonApiDocument = { data: [] };
    const el = new GenericEntityList().build([], { viewMode: "default", doc, link });
    const { lastFrame } = render(<FocusRegistryProvider>{el}</FocusRegistryProvider>);
    expect(lastFrame()).toContain("(no results)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/tui && npx vitest run tests/unit/entity-list.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `plugins/tui/src/entity-list.tsx`**:

```tsx
import type { JsonApiResource } from "dropsh/plugin";
import { Box, Text } from "ink";
import React, { type ReactElement } from "react";
import { TuiLink } from "./link.js";
import type { BuildContext } from "./types.js";

export abstract class TuiEntityList {
  static entityType: string;
  static bundle?: string;
  abstract build(resources: JsonApiResource[], ctx: BuildContext): ReactElement;
}

function label(res: JsonApiResource): string {
  const attrs = res.attributes ?? {};
  for (const key of ["title", "name", "label"]) {
    const v = attrs[key];
    if (typeof v === "string") return v;
  }
  return res.id;
}

function splitType(type: string): { entityType: string; bundle?: string } {
  const [entityType, bundle] = type.split("--");
  return bundle ? { entityType, bundle } : { entityType };
}

export class GenericEntityList extends TuiEntityList {
  static override entityType = "*";

  build(resources: JsonApiResource[], ctx: BuildContext): ReactElement {
    if (resources.length === 0) return <Text dimColor>(no results)</Text>;
    return (
      <Box flexDirection="column">
        {resources.map((res) => {
          const { entityType, bundle } = splitType(res.type);
          const params: Record<string, string> = { type: entityType, id: res.id };
          if (bundle) params.bundle = bundle;
          return (
            <TuiLink key={res.id} target={ctx.link("entity.canonical", params)}>
              {label(res)}
            </TuiLink>
          );
        })}
      </Box>
    );
  }
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd plugins/tui && npx vitest run tests/unit/entity-list.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/tui/src/entity-list.tsx plugins/tui/tests/unit/entity-list.test.tsx
git commit -m "feat(tui): add TuiEntityList base and GenericEntityList default handler"
```

---

### Task 6: Registry + default routes

**Files:**
- Create: `plugins/tui/src/registry.ts`
- Test: `plugins/tui/tests/unit/registry.test.ts`

**Interfaces:**
- Consumes: `TuiSubPlugin`, `TuiRoute`, `ControllerContext`, `EntityViewClass`, `EntityListClass` (Task 3); `GenericEntityView` (Task 4); `GenericEntityList` (Task 5).
- Produces: `buildRegistry(plugins: TuiSubPlugin[]): Registry` where `Registry` has `resolveView(entityType, bundle?): EntityViewClass`, `resolveList(entityType, bundle?): EntityListClass` (both falling back `type:bundle` → `type:` → generic), and `routes: Map<string, TuiRoute>` seeded with `entity.canonical` (path `/{type}/{bundle}/{id}`) and `entity.collection` (path `/{type}`) core defaults plus every sub-plugin `route` (later routes override earlier by `name`). The default controllers use `ControllerContext.resolveView`/`resolveList` and `seededDoc`.

- [ ] **Step 1: Write the failing test** — `plugins/tui/tests/unit/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GenericEntityList } from "../../src/entity-list.js";
import { GenericEntityView } from "../../src/entity-view.js";
import { buildRegistry } from "../../src/registry.js";
import { TuiEntityView } from "../../src/entity-view.js";

class ArticleView extends TuiEntityView {
  static override entityType = "node";
  static override bundle = "article";
  static override viewModes = { default: {}, teaser: {} };
  build() {
    return null as never;
  }
}

describe("buildRegistry", () => {
  it("resolves a registered view by type+bundle, else the generic default", () => {
    const reg = buildRegistry([{ id: "x", entities: [ArticleView] }]);
    expect(reg.resolveView("node", "article")).toBe(ArticleView);
    expect(reg.resolveView("node", "page")).toBe(GenericEntityView);
    expect(reg.resolveView("user")).toBe(GenericEntityView);
    expect(reg.resolveList("node", "article")).toBe(GenericEntityList);
  });

  it("provides core default routes and lets sub-plugin routes override by name", () => {
    const custom = { name: "entity.canonical", path: "/custom/{id}", controller: async () => null as never };
    const reg = buildRegistry([{ id: "x", routes: [custom] }]);
    expect(reg.routes.get("entity.collection")?.path).toBe("/{type}");
    expect(reg.routes.get("entity.canonical")).toBe(custom);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/tui && npx vitest run tests/unit/registry.test.ts`
Expected: FAIL — `buildRegistry` not found.

- [ ] **Step 3: Create `plugins/tui/src/registry.ts`**:

```ts
import type { JsonApiResource } from "dropsh/plugin";
import React from "react";
import { GenericEntityList, TuiEntityList } from "./entity-list.js";
import { GenericEntityView, TuiEntityView } from "./entity-view.js";
import type {
  ControllerContext,
  EntityListClass,
  EntityViewClass,
  TuiRoute,
  TuiSubPlugin,
} from "./types.js";

export interface Registry {
  resolveView(entityType: string, bundle?: string): EntityViewClass;
  resolveList(entityType: string, bundle?: string): EntityListClass;
  routes: Map<string, TuiRoute>;
}

function key(entityType: string, bundle?: string): string {
  return `${entityType}:${bundle ?? ""}`;
}

function isView(c: unknown): c is EntityViewClass {
  return typeof c === "function" && (c as typeof TuiEntityView).prototype instanceof TuiEntityView;
}
function isList(c: unknown): c is EntityListClass {
  return typeof c === "function" && (c as typeof TuiEntityList).prototype instanceof TuiEntityList;
}

function buildCtxLink(ctx: ControllerContext) {
  return {
    viewMode: ctx.viewMode,
    link: (route: string, params: Record<string, string>) => ({ route, params }),
  };
}

function coreRoutes(): TuiRoute[] {
  const canonical: TuiRoute = {
    name: "entity.canonical",
    path: "/{type}/{bundle}/{id}",
    controller: async (params, ctx) => {
      const ViewClass = ctx.resolveView(params.type, params.bundle);
      const doc =
        ctx.seededDoc ??
        (await ctx.client.get(
          params.bundle ? `${params.type}/${params.bundle}/${params.id}` : `${params.type}/${params.id}`,
        ));
      const entity = (Array.isArray(doc.data) ? doc.data[0] : doc.data) as JsonApiResource;
      const instance = new (ViewClass as unknown as { new (): { build: TuiEntityView["build"] } })();
      return React.createElement(React.Fragment, null, instance.build(entity, { doc, ...buildCtxLink(ctx) }));
    },
  };
  const collection: TuiRoute = {
    name: "entity.collection",
    path: "/{type}",
    controller: async (params, ctx) => {
      const ListClass = ctx.resolveList(params.type, params.bundle);
      const doc = ctx.seededDoc ?? (await ctx.client.get(params.type));
      const rows = (Array.isArray(doc.data) ? doc.data : [doc.data]) as JsonApiResource[];
      const instance = new (ListClass as unknown as { new (): { build: TuiEntityList["build"] } })();
      return React.createElement(React.Fragment, null, instance.build(rows, { doc, ...buildCtxLink(ctx) }));
    },
  };
  return [canonical, collection];
}

export function buildRegistry(plugins: TuiSubPlugin[]): Registry {
  const views = new Map<string, EntityViewClass>();
  const lists = new Map<string, EntityListClass>();
  const routes = new Map<string, TuiRoute>();

  for (const r of coreRoutes()) routes.set(r.name, r);

  for (const p of plugins) {
    for (const entity of p.entities ?? []) {
      if (isView(entity)) views.set(key(entity.entityType, entity.bundle), entity);
      else if (isList(entity)) lists.set(key(entity.entityType, entity.bundle), entity);
    }
    for (const route of p.routes ?? []) routes.set(route.name, route);
  }

  return {
    resolveView: (t, b) => views.get(key(t, b)) ?? views.get(key(t)) ?? GenericEntityView,
    resolveList: (t, b) => lists.get(key(t, b)) ?? lists.get(key(t)) ?? GenericEntityList,
    routes,
  };
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd plugins/tui && npx vitest run tests/unit/registry.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/tui/src/registry.ts plugins/tui/tests/unit/registry.test.ts
git commit -m "feat(tui): add handler registry with generic fallback and core default routes"
```

---

### Task 7: Router (history stack + upcasting)

**Files:**
- Create: `plugins/tui/src/router.ts`
- Test: `plugins/tui/tests/unit/router.test.ts`

**Interfaces:**
- Consumes: `Registry` (Task 6); `TuiRoute`, `ControllerContext` (Task 3); `JsonApiClient` (from `dropsh/plugin`).
- Produces: `createRouter(opts: { registry: Registry; client: JsonApiClient; viewMode: string }): Router`. `Router` = `{ stackDepth(): number; current(): Promise<ReactElement>; navigate(route, params, seededDoc?): Promise<void>; back(): boolean; }`. `navigate` resolves the named route, runs its controller with a `ControllerContext` (wiring `resolveView`/`resolveList` from the registry, `client`, `viewMode`, `seededDoc`, and a `navigate` that pushes), pushes the resulting element onto the stack. `back()` pops and returns `false` when the stack becomes empty (host should exit). `current()` returns the top element.

- [ ] **Step 1: Write the failing test** — `plugins/tui/tests/unit/router.test.ts`:

```ts
import type { JsonApiClient } from "dropsh/plugin";
import { describe, expect, it, vi } from "vitest";
import { buildRegistry } from "../../src/registry.js";
import { createRouter } from "../../src/router.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(async (path: string) => ({ data: { type: "node--article", id: path.split("/").pop() ?? "x" } })),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as JsonApiClient;
}

describe("createRouter", () => {
  it("uses the seeded doc without fetching on the first navigate", async () => {
    const c = client();
    const router = createRouter({ registry: buildRegistry([]), client: c, viewMode: "default" });
    await router.navigate("entity.canonical", { type: "node", bundle: "article", id: "u1" }, {
      data: { type: "node--article", id: "u1", attributes: { title: "Seed" } },
    });
    expect(router.stackDepth()).toBe(1);
    expect(c.get).not.toHaveBeenCalled();
  });

  it("fetches (upcasts) when navigating without a seeded doc, and back() pops", async () => {
    const c = client();
    const router = createRouter({ registry: buildRegistry([]), client: c, viewMode: "default" });
    await router.navigate("entity.canonical", { type: "node", bundle: "article", id: "u1" });
    await router.navigate("entity.canonical", { type: "user", id: "a1" });
    expect(c.get).toHaveBeenCalledTimes(2);
    expect(router.stackDepth()).toBe(2);
    expect(router.back()).toBe(true);
    expect(router.stackDepth()).toBe(1);
    expect(router.back()).toBe(false);
  });

  it("throws on an unknown route name", async () => {
    const router = createRouter({ registry: buildRegistry([]), client: client(), viewMode: "default" });
    await expect(router.navigate("nope", {})).rejects.toThrow(/unknown route/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/tui && npx vitest run tests/unit/router.test.ts`
Expected: FAIL — `createRouter` not found.

- [ ] **Step 3: Create `plugins/tui/src/router.ts`**:

```ts
import type { JsonApiClient } from "dropsh/plugin";
import type { ReactElement } from "react";
import type { Registry } from "./registry.js";
import type { ControllerContext } from "./types.js";

export interface Router {
  stackDepth(): number;
  current(): ReactElement | null;
  navigate(
    route: string,
    params: Record<string, string>,
    seededDoc?: import("dropsh/plugin").JsonApiDocument,
  ): Promise<void>;
  back(): boolean;
}

export function createRouter(opts: {
  registry: Registry;
  client: JsonApiClient;
  viewMode: string;
}): Router {
  const stack: ReactElement[] = [];

  async function navigate(
    routeName: string,
    params: Record<string, string>,
    seededDoc?: import("dropsh/plugin").JsonApiDocument,
  ): Promise<void> {
    const route = opts.registry.routes.get(routeName);
    if (!route) throw new Error(`unknown route: ${routeName}`);
    const ctx: ControllerContext = {
      client: opts.client,
      viewMode: opts.viewMode,
      seededDoc,
      navigate: (r, p) => {
        void navigate(r, p);
      },
      resolveView: opts.registry.resolveView,
      resolveList: opts.registry.resolveList,
    };
    const element = await route.controller(params, ctx);
    stack.push(element);
  }

  return {
    stackDepth: () => stack.length,
    current: () => stack[stack.length - 1] ?? null,
    navigate,
    back() {
      stack.pop();
      return stack.length > 0;
    },
  };
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd plugins/tui && npx vitest run tests/unit/router.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/tui/src/router.ts plugins/tui/tests/unit/router.test.ts
git commit -m "feat(tui): add router with history stack and param upcasting"
```

---

### Task 8: Browse host (Ink app wiring router + focus + keys)

**Files:**
- Modify (rewrite): `plugins/tui/src/browse-app.tsx`
- Replace test: `plugins/tui/tests/unit/browse-app.test.tsx`

**Interfaces:**
- Consumes: `Router` (Task 7); `FocusRegistryProvider` (Task 3).
- Produces: `<Browse router={Router} onExit={() => void}>` — a component that renders `router.current()` inside a `FocusRegistryProvider` (focusedIndex state), moves focus with `↑`/`↓` over the registered `TuiLink`s, `Enter` calls `router.navigate` on the focused link's target then re-renders, `q`/`Esc` calls `router.back()` and `onExit()` when it returns `false`. The `Browse` component takes an already-initialised router whose first route has been navigated (seeded) by the caller (Task 9).

- [ ] **Step 1: Write the failing test** — overwrite `plugins/tui/tests/unit/browse-app.test.tsx`:

```tsx
import type { JsonApiClient } from "dropsh/plugin";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { Browse } from "../../src/browse-app.js";
import { buildRegistry } from "../../src/registry.js";
import { createRouter } from "../../src/router.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(async () => ({ data: { type: "node--article", id: "u9", attributes: { title: "Fetched" } } })),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as JsonApiClient;
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("Browse", () => {
  it("renders the seeded entity via the generic view", async () => {
    const c = client();
    const router = createRouter({ registry: buildRegistry([]), client: c, viewMode: "default" });
    await router.navigate("entity.canonical", { type: "node", bundle: "article", id: "u1" }, {
      data: {
        type: "node--article",
        id: "u1",
        attributes: { title: "Alpha" },
        relationships: { uid: { data: { type: "user--user", id: "a1" } } },
      },
    });
    const { lastFrame } = render(<Browse router={router} onExit={() => {}} />);
    await tick();
    expect(lastFrame()).toContain("Alpha");
    expect(lastFrame()).toContain("uid");
  });

  it("exits when back() empties the stack", async () => {
    const c = client();
    const router = createRouter({ registry: buildRegistry([]), client: c, viewMode: "default" });
    await router.navigate("entity.canonical", { type: "node", bundle: "article", id: "u1" }, {
      data: { type: "node--article", id: "u1", attributes: { title: "Alpha" } },
    });
    const onExit = vi.fn();
    const { stdin } = render(<Browse router={router} onExit={onExit} />);
    await tick();
    stdin.write("q");
    await tick();
    expect(onExit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/tui && npx vitest run tests/unit/browse-app.test.tsx`
Expected: FAIL — new `Browse` props/behavior not implemented.

- [ ] **Step 3: Rewrite `plugins/tui/src/browse-app.tsx`**:

```tsx
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";
import { FocusRegistryProvider, useFocusRegistry } from "./link.js";
import type { Router } from "./router.js";

export interface BrowseProps {
  router: Router;
  onExit: () => void;
}

// Inner component: has access to the focus registry so Enter can read the
// focused link target and ask the router to navigate to it.
function Keys({
  router,
  onExit,
  focusedIndex,
  setFocusedIndex,
  bump,
}: {
  router: Router;
  onExit: () => void;
  focusedIndex: number;
  setFocusedIndex: (fn: (i: number) => number) => void;
  bump: () => void;
}): null {
  const reg = useFocusRegistry();
  useInput((input, key) => {
    if (input === "q" || key.escape) {
      const hasMore = router.back();
      if (!hasMore) onExit();
      else {
        setFocusedIndex(() => 0);
        bump();
      }
      return;
    }
    if (key.upArrow) setFocusedIndex((i) => Math.max(0, i - 1));
    if (key.downArrow) setFocusedIndex((i) => Math.min(Math.max(0, reg.count() - 1), i + 1));
    if (key.return) {
      const target = reg.targetAt(focusedIndex);
      if (target) {
        void router.navigate(target.route, target.params).then(() => {
          setFocusedIndex(() => 0);
          bump();
        });
      }
    }
  });
  return null;
}

export function Browse({ router, onExit }: BrowseProps): React.ReactElement {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [, setNonce] = useState(0);
  const bump = () => setNonce((n) => n + 1);
  const element = router.current();
  return (
    <FocusRegistryProvider focusedIndex={focusedIndex}>
      <Box flexDirection="column">
        {element}
        <Text dimColor>(↑/↓: move, enter: open, q/esc: back)</Text>
      </Box>
      <Keys
        router={router}
        onExit={onExit}
        focusedIndex={focusedIndex}
        setFocusedIndex={setFocusedIndex}
        bump={bump}
      />
    </FocusRegistryProvider>
  );
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd plugins/tui && npx vitest run tests/unit/browse-app.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/tui/src/browse-app.tsx plugins/tui/tests/unit/browse-app.test.tsx
git commit -m "feat(tui): rewrite Browse host to drive the router with focusable links"
```

---

### Task 9: tuiPlugin factory + run() wiring; remove obsolete views model

**Files:**
- Modify (rewrite): `plugins/tui/src/index.ts`
- Delete: `plugins/tui/src/views.ts`, `plugins/tui/tests/unit/views.test.ts`
- Test: `plugins/tui/tests/unit/index.test.tsx`

**Interfaces:**
- Consumes: `RenderServices`, `RenderContext` (core, Task 1); `buildRegistry` (Task 6); `createRouter` (Task 7); `Browse` (Task 8); `TuiSubPlugin` (Task 3).
- Produces: `tuiPlugin(opts?: { plugins?: TuiSubPlugin[] }): DrupalCliPlugin` whose interactive renderer `run(doc, ctx, services)` builds the registry (once, from `opts.plugins`), creates a router with `services.client` + `ctx.viewMode ?? "default"`, navigates the initial route (canonical for `command==="read"`, collection for `"search"`) seeding `doc`, then renders `<Browse>` via `ink`. Re-exports `TuiEntityView`, `TuiEntityList`, `TuiLink`, and the types for sub-plugin authors. `assertTty` behavior is preserved.

- [ ] **Step 1: Write the failing test** — create `plugins/tui/tests/unit/index.test.tsx`:

```tsx
import type { JsonApiDocument, RenderContext, RenderServices } from "dropsh/plugin";
import { describe, expect, it, vi } from "vitest";
import { tuiPlugin } from "../../src/index.js";

function services(): RenderServices {
  return {
    client: { get: vi.fn(async () => ({ data: [] })) } as never,
    baseUrl: "https://x.test",
  };
}

describe("tuiPlugin", () => {
  it("exposes an interactive renderer with id 'tui'", () => {
    const plugin = tuiPlugin();
    const renderer = plugin.renderers?.[0];
    expect(renderer?.id).toBe("tui");
    expect((renderer as { interactive?: boolean }).interactive).toBe(true);
  });

  it("run() rejects when stdout is not a TTY", async () => {
    const plugin = tuiPlugin();
    const renderer = plugin.renderers?.[0] as {
      run: (d: JsonApiDocument, c: RenderContext, s?: RenderServices) => Promise<void>;
    };
    const orig = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    await expect(
      renderer.run({ data: { type: "node--article", id: "u1" } }, { command: "read" }, services()),
    ).rejects.toThrow(/interactive terminal/i);
    Object.defineProperty(process.stdout, "isTTY", { value: orig, configurable: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/tui && npx vitest run tests/unit/index.test.tsx`
Expected: FAIL — new `tuiPlugin` shape not implemented.

- [ ] **Step 3: Rewrite `plugins/tui/src/index.ts`**:

```ts
import type {
  DrupalCliPlugin,
  JsonApiDocument,
  JsonApiResource,
  RenderContext,
  RenderServices,
} from "dropsh/plugin";
import { ConfigError } from "dropsh/plugin";
import { buildRegistry } from "./registry.js";
import { createRouter } from "./router.js";
import type { TuiSubPlugin } from "./types.js";

export { TuiEntityView, GenericEntityView } from "./entity-view.js";
export { TuiEntityList, GenericEntityList } from "./entity-list.js";
export { TuiLink } from "./link.js";
export type {
  TuiSubPlugin,
  TuiRoute,
  TuiController,
  BuildContext,
  LinkDescriptor,
  ViewModeMap,
} from "./types.js";

export interface TuiOptions {
  plugins?: TuiSubPlugin[];
}

function assertTty(isTty: boolean): void {
  if (!isTty) throw new ConfigError("--format tui requires an interactive terminal");
}

function initialTarget(doc: JsonApiDocument, ctx: RenderContext): {
  route: string;
  params: Record<string, string>;
} {
  if (ctx.command === "search") {
    const params: Record<string, string> = { type: ctx.entityType ?? "" };
    if (ctx.bundle) params.bundle = ctx.bundle;
    return { route: "entity.collection", params };
  }
  const first = (Array.isArray(doc.data) ? doc.data[0] : doc.data) as JsonApiResource | undefined;
  const [entityType, bundle] = (first?.type ?? "--").split("--");
  const params: Record<string, string> = { type: entityType, id: first?.id ?? "" };
  if (bundle) params.bundle = bundle;
  return { route: "entity.canonical", params };
}

async function runTui(
  doc: JsonApiDocument,
  ctx: RenderContext,
  opts: TuiOptions,
  services?: RenderServices,
): Promise<void> {
  assertTty(Boolean(process.stdout.isTTY));
  if (!services) throw new ConfigError("--format tui requires runtime services (client)");
  const registry = buildRegistry(opts.plugins ?? []);
  const router = createRouter({ registry, client: services.client, viewMode: ctx.viewMode ?? "default" });
  const target = initialTarget(doc, ctx);
  await router.navigate(target.route, target.params, doc);

  const [{ render }, React, { Browse }] = await Promise.all([
    import("ink"),
    import("react"),
    import("./browse-app.js"),
  ]);
  const app = render(
    React.createElement(Browse, { router, onExit: () => app.unmount() }),
  );
  await app.waitUntilExit();
}

export function tuiPlugin(tuiOpts: TuiOptions = {}): DrupalCliPlugin {
  return {
    id: "tui",
    requiredModules: [],
    async extendSchema(_entityType, _bundle, schema) {
      return schema;
    },
    renderers: [
      {
        id: "tui",
        interactive: true,
        run: (doc, ctx, services) => runTui(doc, ctx, tuiOpts, services),
      },
    ],
  };
}
```

- [ ] **Step 4: Delete the obsolete config-views model**

```bash
git rm plugins/tui/src/views.ts plugins/tui/tests/unit/views.test.ts
```

- [ ] **Step 5: Run the full package + core suites**

Run: `cd plugins/tui && npx vitest run && npx tsc --noEmit && cd ../.. && npm run lint && npm run typecheck && npm test`
Expected: PASS across the board. If lint flags import ordering or `React` unused, run `npm run lint:fix`.

- [ ] **Step 6: Commit**

```bash
git add plugins/tui/src/index.ts plugins/tui/tests/unit/index.test.tsx
git commit -m "feat(tui): entity-router tuiPlugin factory with sub-plugins, drop config-views model"
```

---

## Self-Review

**Spec coverage:**
- Two decoupled layers → Tasks 6 (routes) + 4/5 (handlers). ✓
- `TuiRoute`/router/upcasting/history → Task 7. ✓
- `TuiEntityView`/`TuiEntityList` base + static metadata → Tasks 4/5. ✓
- `TuiLink` navigable focus → Tasks 3/8. ✓
- Generic default handler → Tasks 4/5, fallback resolution Task 6. ✓
- `tuiPlugin({ plugins })` owns registry, `DrupalCliPlugin` untouched → Task 9. ✓
- Sole core touch = services + `--view-mode` → Tasks 1/2. ✓
- Seed initial doc, no double fetch → Tasks 7 (test) + 9 (wiring). ✓
- Framework-only, exports for sub-plugin packages → Task 9 re-exports. ✓
- Out-of-scope items → none implemented. ✓

**Placeholder scan:** No TBD/TODO; every code step contains full code. ✓

**Type consistency:** `RenderServices { client, baseUrl }` (Task 1) consumed identically in Tasks 2/9. `ControllerContext` (Task 3) built in Task 6 controllers and Task 7 router — fields match (`client`, `viewMode`, `seededDoc`, `navigate`, `resolveView`, `resolveList`). `Registry.resolveView/resolveList/routes` (Task 6) consumed in Task 7. `Router` methods (`stackDepth`, `current`, `navigate`, `back`) consistent Tasks 7↔8. `Browse` props `{ router, onExit }` consistent Tasks 8↔9. `entity.canonical` path `/{type}/{bundle}/{id}` used consistently. ✓

**Note for implementer:** `JsonApiResource.relationships` typing may be loose; the generic view casts `rel.data` defensively. If `tsc` complains about `JsonApiClient` methods in test doubles, cast via `as unknown as JsonApiClient` (matches the existing `index-format.test.ts` pattern).
