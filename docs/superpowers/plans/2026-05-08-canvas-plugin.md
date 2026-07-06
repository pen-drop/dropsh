# Canvas Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@dropsh/plugin-canvas` so `dropsh schema canvas_page/canvas_page --for=create|update` contains enough Canvas and SDC metadata for an AI to generate valid Canvas JSON:API payloads.

**Architecture:** Keep Schemata as the pre-operation schema source, then add a new optional post-operation schema hook for builder plugins. The Canvas plugin fetches SDC metadata from `jsonapi_sdc` at `/jsonapi/sdc_component`, maps SDC IDs from `provider:name` to Canvas IDs `sdc.provider.name`, and enriches the operation-specific schema for `canvas_page/canvas_page`.

**Tech Stack:** TypeScript, Commander, Vitest, JSON Schema draft-07, Drupal JSON:API, `drupal/canvas`, `drupal/jsonapi_sdc`, DDEV.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/core/plugin.ts` | Modify | Add an optional operation-aware schema hook without breaking existing plugins. |
| `src/plugin-api.ts` | Modify | Export the new operation schema types. |
| `src/core/schema/jsonschema-source.ts` | Modify | Continue running existing `extendSchema()` hooks before operation conversion. |
| `src/commands/schema.ts` | Modify | Convert to create/update schema, then run operation schema hooks, then tag/cache output. |
| `src/index.ts` | Modify | Use the same operation schema pipeline when create/update validation loads a schema. |
| `tests/unit/core/plugin.test.ts` | Modify | Cover the optional hook shape. |
| `tests/unit/commands/schema.test.ts` | Modify | Cover operation hook invocation and metadata. |
| `plugins/canvas/package.json` | Create | Canvas plugin package metadata and scripts. |
| `plugins/canvas/tsconfig.json` | Create | Canvas plugin TypeScript config. |
| `plugins/canvas/src/sdc-client.ts` | Create | Fetch and normalize `jsonapi_sdc` components. |
| `plugins/canvas/src/canvas-schema.ts` | Create | Build Canvas schema fragments and metadata from normalized SDC components. |
| `plugins/canvas/src/index.ts` | Create | Export `canvasPlugin()`. |
| `plugins/canvas/tests/unit/sdc-client.test.ts` | Create | Unit tests for `jsonapi_sdc` fetching and normalization. |
| `plugins/canvas/tests/unit/canvas-schema.test.ts` | Create | Unit tests for Canvas schema enrichment. |
| `plugins/canvas/tests/unit/index.test.ts` | Create | Unit tests for plugin target matching and errors. |
| `package.json` | Modify | Include Canvas in plugin build script. |
| `README.md` | Modify | Document Canvas plugin setup and `schema` usage. |
| `tests/integrations/drupal/composer.json` | Modify | Add `drupal/canvas` and `drupal/jsonapi_sdc` for integration verification. |
| `tests/integrations/drupal/fixtures/setup-canvas.php` | Create or modify | Ensure Canvas fixture can expose at least one SDC component. |
| `tests/integrations/schema/canvas-schema.integration.test.ts` | Create | Verify live DDEV schema includes Canvas component metadata. |

## Task 1: Create the Feature Branch

**Files:** git operations only

- [ ] **Step 1: Create and switch to the branch**

Run:

```bash
git switch -c feat/canvas-plugin
```

Expected: command exits `0` and `git branch --show-current` prints `feat/canvas-plugin`.

- [ ] **Step 2: Confirm the worktree is clean except ignored local agent files**

Run:

```bash
git status --short
```

Expected: no tracked file changes. Untracked `.claude/` or `.codex` may remain and must not be added.

## Task 2: Add an Operation-Aware Schema Hook

**Files:**
- Modify: `src/core/plugin.ts`
- Modify: `src/plugin-api.ts`
- Modify: `tests/unit/core/plugin.test.ts`

- [ ] **Step 1: Write the failing plugin interface test**

Add this test to `tests/unit/core/plugin.test.ts`:

```ts
it("accepts an optional operation-aware schema hook", async () => {
  const plugin: DrupalCliPlugin = {
    id: "builder",
    requiredModules: ["jsonapi_sdc"],
    async extendSchema(_e, _b, s) {
      return s;
    },
    async extendOperationSchema(_entity, _bundle, operation, schema, _ctx) {
      return {
        ...(schema as Record<string, unknown>),
        "x-test-operation": operation,
      };
    },
  };

  const schema = { type: "object" };
  const extended = await plugin.extendOperationSchema!(
    "canvas_page",
    "canvas_page",
    "create",
    schema,
    ctx,
  );

  expect(extended).toEqual({ type: "object", "x-test-operation": "create" });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- tests/unit/core/plugin.test.ts
```

Expected: TypeScript/Vitest fails because `extendOperationSchema` is not part of `DrupalCliPlugin`.

- [ ] **Step 3: Extend the plugin interface**

Update `src/core/plugin.ts` so it contains these additional exports and optional method:

```ts
import type { Command } from "commander";
import type { AuthAdapter } from "./auth/types.js";
import type { HttpClient } from "./http.js";
import type { Operation } from "./schema/to-jsonschema.js";

export interface PluginContext {
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
}

export type SchemaOperation = Operation;

export interface DrupalCliPlugin {
  readonly id: string;
  readonly requiredModules: string[];
  createAuthAdapter?(): AuthAdapter;
  extendSchema(
    entityType: string,
    bundle: string,
    baseSchema: unknown,
    ctx: PluginContext,
  ): Promise<unknown>;
  extendOperationSchema?(
    entityType: string,
    bundle: string,
    operation: SchemaOperation,
    operationSchema: unknown,
    ctx: PluginContext,
  ): Promise<unknown>;
  registerCommands?(program: Command): void;
}
```

- [ ] **Step 4: Export the new type through the public plugin API**

Update `src/plugin-api.ts` to export `SchemaOperation`:

```ts
export type { AuthAdapter } from "./core/auth/types.js";
export type { Config, SiteConfig } from "./core/config.js";
export { loadConfig } from "./core/config.js";
export type { HttpClient, HttpRequest } from "./core/http.js";
export { createHttpClient } from "./core/http.js";
export type { DrupalCliPlugin, PluginContext, SchemaOperation } from "./core/plugin.js";
export { AuthError, ConfigError, HttpError, ValidationError } from "./errors.js";
export type { BasicAuthConfig } from "./core/auth/basic.js";
export { basicAuthPlugin } from "./core/auth/basic.js";
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
npm test -- tests/unit/core/plugin.test.ts
```

Expected: all tests in `plugin.test.ts` pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/core/plugin.ts src/plugin-api.ts tests/unit/core/plugin.test.ts
git commit -m "feat: add operation schema plugin hook"
```

## Task 3: Run Operation Hooks in the Schema Command

**Files:**
- Modify: `src/commands/schema.ts`
- Modify: `src/index.ts`
- Modify: `tests/unit/commands/schema.test.ts`

- [ ] **Step 1: Add a failing command test for operation hook invocation**

Add this test to `tests/unit/commands/schema.test.ts`:

```ts
it("runs operation schema hooks after create/update conversion", async () => {
  const emitted: unknown[] = [];
  const warnings: string[] = [];
  const http = seqHttp([
    {
      status: 200,
      body: JSON.stringify({
        data: [
          {
            type: "canvas_page--canvas_page",
            id: "x",
            attributes: { title: "A", components: [] },
            relationships: {},
          },
        ],
      }),
    },
  ]);
  const plugin = {
    id: "canvas",
    requiredModules: ["canvas", "jsonapi_sdc"],
    async extendSchema(_entity: string, _bundle: string, schema: unknown) {
      return schema;
    },
    async extendOperationSchema(
      _entity: string,
      _bundle: string,
      operation: "create" | "update",
      schema: unknown,
    ) {
      const out = schema as Record<string, unknown>;
      const data = (out.properties as any).data;
      return {
        ...out,
        properties: out.properties,
        "x-test-operation": operation,
        "x-test-data-required": data.required,
      };
    },
  };

  await runSchema(
    { target: "canvas_page/canvas_page", operation: "update", refresh: false },
    {
      http,
      auth,
      baseUrl: "https://ex",
      jsonapiPrefix: "/jsonapi",
      cwd: tempDir(),
      emit: (v) => emitted.push(v),
      warn: (m) => warnings.push(m),
      plugins: [plugin],
    },
  );

  const out = emitted[0] as any;
  expect(out["x-test-operation"]).toBe("update");
  expect(out["x-test-data-required"]).toEqual(["type", "id"]);
  expect(out["x-dropsh-schema-extensions"]).toEqual(["canvas"]);
});
```

- [ ] **Step 2: Run the failing command test**

Run:

```bash
npm test -- tests/unit/commands/schema.test.ts
```

Expected: test fails because `runSchema()` does not call `extendOperationSchema`.

- [ ] **Step 3: Add a helper inside `src/commands/schema.ts`**

Add this helper near the top of `src/commands/schema.ts` after the interfaces:

```ts
async function applyOperationSchemaPlugins(
  schema: unknown,
  args: {
    entity: string;
    bundle: string;
    operation: Operation;
  },
  deps: {
    http: HttpClient;
    auth: AuthAdapter;
    baseUrl: string;
    plugins: DrupalCliPlugin[];
  },
): Promise<{ schema: unknown; extensions: string[] }> {
  let current = schema;
  const extensions: string[] = [];
  const ctx = { http: deps.http, auth: deps.auth, baseUrl: deps.baseUrl };
  for (const plugin of deps.plugins) {
    if (!plugin.extendOperationSchema) continue;
    const extended = await plugin.extendOperationSchema(
      args.entity,
      args.bundle,
      args.operation,
      current,
      ctx,
    );
    if (extended !== current) {
      current = extended;
      extensions.push(plugin.id);
    }
  }
  return { schema: current, extensions };
}
```

- [ ] **Step 4: Use the helper in `runSchema()`**

Replace this block in `src/commands/schema.ts`:

```ts
const transformed = toOperationVariant(raw, args.operation);

const tagged = {
  ...(transformed as Record<string, unknown>),
  "x-dropsh-source": source,
  "x-dropsh-target": { entity_type: entity, bundle },
  "x-dropsh-operation": args.operation,
};
```

with:

```ts
const transformed = toOperationVariant(raw, args.operation);
const operationExtended = await applyOperationSchemaPlugins(
  transformed,
  { entity, bundle, operation: args.operation },
  {
    http: deps.http,
    auth: deps.auth,
    baseUrl: deps.baseUrl,
    plugins: deps.plugins ?? [],
  },
);

const tagged = {
  ...(operationExtended.schema as Record<string, unknown>),
  "x-dropsh-source": source,
  "x-dropsh-target": { entity_type: entity, bundle },
  "x-dropsh-operation": args.operation,
  "x-dropsh-schema-extensions": operationExtended.extensions,
};
```

- [ ] **Step 5: Export the helper for CLI validation reuse**

Change the helper declaration to:

```ts
export async function applyOperationSchemaPlugins(
```

- [ ] **Step 6: Update `src/index.ts` validation schema loading**

Import the helper:

```ts
import { applyOperationSchemaPlugins, runSchema } from "./commands/schema.js";
```

Then replace the tagging block inside `loadOrFetchSchema()`:

```ts
const transformed = toOperationVariant(raw, op);
const tagged = {
  ...(transformed as Record<string, unknown>),
  "x-dropsh-source": source,
  "x-dropsh-target": { entity_type: entity, bundle },
  "x-dropsh-operation": op,
};
```

with:

```ts
const transformed = toOperationVariant(raw, op);
const operationExtended = await applyOperationSchemaPlugins(
  transformed,
  { entity, bundle, operation: op },
  {
    http: ctx.http,
    auth: ctx.auth,
    baseUrl: ctx.baseUrl,
    plugins: ctx.plugins,
  },
);
const tagged = {
  ...(operationExtended.schema as Record<string, unknown>),
  "x-dropsh-source": source,
  "x-dropsh-target": { entity_type: entity, bundle },
  "x-dropsh-operation": op,
  "x-dropsh-schema-extensions": operationExtended.extensions,
};
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm test -- tests/unit/commands/schema.test.ts tests/unit/index.test.ts tests/unit/core/schema/jsonschema-source.test.ts
```

Expected: all listed tests pass. Existing Schemata-related tests still pass because `extendSchema()` behavior is unchanged.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/commands/schema.ts src/index.ts tests/unit/commands/schema.test.ts
git commit -m "feat: apply builder schema extensions after operation conversion"
```

## Task 4: Create the Canvas Plugin Package Skeleton

**Files:**
- Create: `plugins/canvas/package.json`
- Create: `plugins/canvas/tsconfig.json`
- Create: `plugins/canvas/src/index.ts`
- Create: `plugins/canvas/tests/unit/index.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the package files**

Create `plugins/canvas/package.json`:

```json
{
  "name": "@dropsh/plugin-canvas",
  "version": "0.0.1-alpha.0",
  "type": "module",
  "main": "./dist/plugins/canvas/src/index.js",
  "exports": {
    ".": "./dist/plugins/canvas/src/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "dropsh": "*"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

Create `plugins/canvas/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "noEmit": false
  },
  "include": ["src", "tests"]
}
```

Create `plugins/canvas/src/index.ts`:

```ts
import type { DrupalCliPlugin } from "dropsh/plugin";

export function canvasPlugin(): DrupalCliPlugin {
  return {
    id: "canvas",
    requiredModules: ["canvas", "jsonapi_sdc"],
    async extendSchema(_entityType, _bundle, schema) {
      return schema;
    },
    async extendOperationSchema(_entityType, _bundle, _operation, schema) {
      return schema;
    },
  };
}
```

- [ ] **Step 2: Add the initial plugin test**

Create `plugins/canvas/tests/unit/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canvasPlugin } from "../../src/index.js";

describe("canvasPlugin", () => {
  it("declares Canvas and jsonapi_sdc as required modules", () => {
    const plugin = canvasPlugin();
    expect(plugin.id).toBe("canvas");
    expect(plugin.requiredModules).toEqual(["canvas", "jsonapi_sdc"]);
  });

  it("leaves pre-operation schemas unchanged", async () => {
    const schema = { type: "object" };
    const result = await canvasPlugin().extendSchema("canvas_page", "canvas_page", schema, {} as any);
    expect(result).toBe(schema);
  });

  it("leaves operation schemas unchanged before Canvas enrichment is implemented", async () => {
    const schema = { type: "object" };
    const result = await canvasPlugin().extendOperationSchema!(
      "node",
      "article",
      "create",
      schema,
      {} as any,
    );
    expect(result).toBe(schema);
  });
});
```

- [ ] **Step 3: Include Canvas in the root plugin build script**

Update `package.json`:

```json
"build:plugins": "npm --prefix plugins/schemata run build && npm --prefix plugins/oauth2 run build && npm --prefix plugins/canvas run build"
```

- [ ] **Step 4: Run the new package tests**

Run:

```bash
npm --prefix plugins/canvas test
```

Expected: the three Canvas skeleton tests pass.

- [ ] **Step 5: Run root typecheck**

Run:

```bash
npm run typecheck
```

Expected: TypeScript passes.

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json plugins/canvas
git commit -m "feat: add Canvas plugin package"
```

## Task 5: Implement the `jsonapi_sdc` Client

**Files:**
- Create: `plugins/canvas/src/sdc-client.ts`
- Create: `plugins/canvas/tests/unit/sdc-client.test.ts`

- [ ] **Step 1: Write failing SDC client tests**

Create `plugins/canvas/tests/unit/sdc-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { HttpError, type PluginContext } from "dropsh/plugin";
import { fetchSdcComponents, toCanvasComponentId } from "../../src/sdc-client.js";

function ctx(responses: Array<{ status: number; body: string }>): PluginContext {
  let i = 0;
  return {
    http: {
      send: vi.fn(async () => {
        const r = responses[i++]!;
        if (r.status >= 200 && r.status < 300) return { status: r.status, headers: {}, body: r.body };
        throw new HttpError(r.status, `HTTP ${r.status}`, r.body);
      }),
    },
    auth: { apply: async (req) => req },
    baseUrl: "https://example.com",
  };
}

describe("sdc-client", () => {
  it("maps Drupal SDC IDs to Canvas component IDs", () => {
    expect(toCanvasComponentId("olivero:teaser")).toBe("sdc.olivero.teaser");
    expect(toCanvasComponentId("my_theme:hero_card")).toBe("sdc.my_theme.hero_card");
  });

  it("fetches and normalizes jsonapi_sdc components", async () => {
    const context = ctx([
      {
        status: 200,
        body: JSON.stringify({
          data: [
            {
              type: "sdc_component--sdc_component",
              id: "olivero--teaser",
              attributes: {
                drupal_internal__id: "olivero:teaser",
                name: "Teaser",
                description: "A teaser component.",
                status: "stable",
                provider: "olivero",
                props: {
                  type: "object",
                  properties: {
                    title: { type: "string", title: "Title" },
                  },
                },
                slots: {
                  content: { title: "Content" },
                },
                variants: {
                  default: { title: "Default" },
                },
              },
            },
          ],
        }),
      },
    ]);

    const components = await fetchSdcComponents(context);

    expect(components).toEqual([
      {
        id: "olivero:teaser",
        jsonapiId: "olivero--teaser",
        name: "Teaser",
        description: "A teaser component.",
        status: "stable",
        provider: "olivero",
        props: {
          type: "object",
          properties: {
            title: { type: "string", title: "Title" },
          },
        },
        slots: {
          content: { title: "Content" },
        },
        variants: {
          default: { title: "Default" },
        },
      },
    ]);
    expect(context.http.send).toHaveBeenCalledWith({
      method: "GET",
      url: "https://example.com/jsonapi/sdc_component",
      headers: { Accept: "application/vnd.api+json" },
    });
  });

  it("throws a clear error when jsonapi_sdc is unavailable", async () => {
    const context = ctx([{ status: 404, body: "not found" }]);
    await expect(fetchSdcComponents(context)).rejects.toMatchObject({
      code: "E_HTTP",
      message: "Canvas plugin requires Drupal module jsonapi_sdc to build component schemas.",
    });
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm --prefix plugins/canvas test -- tests/unit/sdc-client.test.ts
```

Expected: fails because `src/sdc-client.ts` does not exist.

- [ ] **Step 3: Implement the client**

Create `plugins/canvas/src/sdc-client.ts`:

```ts
import { HttpError, type PluginContext } from "dropsh/plugin";

export interface SdcComponent {
  id: string;
  jsonapiId: string;
  name: string;
  description: string;
  status: string;
  provider: string;
  props: Record<string, unknown>;
  slots: Record<string, unknown>;
  variants: Record<string, unknown>;
}

interface JsonApiSdcResource {
  type?: string;
  id?: string;
  attributes?: {
    drupal_internal__id?: unknown;
    name?: unknown;
    description?: unknown;
    status?: unknown;
    provider?: unknown;
    props?: unknown;
    slots?: unknown;
    variants?: unknown;
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function toCanvasComponentId(sdcId: string): string {
  const [provider, name] = sdcId.split(":", 2);
  if (!provider || !name) return `sdc.${sdcId.replace(/:/g, ".")}`;
  return `sdc.${provider}.${name}`;
}

function normalizeResource(resource: JsonApiSdcResource): SdcComponent | null {
  const attrs = resource.attributes ?? {};
  const internalId = asString(attrs.drupal_internal__id, "");
  if (!internalId.includes(":")) return null;
  const provider = asString(attrs.provider, internalId.split(":", 1)[0] ?? "");
  return {
    id: internalId,
    jsonapiId: asString(resource.id, internalId.replace(/:/g, "--")),
    name: asString(attrs.name, internalId),
    description: asString(attrs.description, ""),
    status: asString(attrs.status, "stable"),
    provider,
    props: asObject(attrs.props),
    slots: asObject(attrs.slots),
    variants: asObject(attrs.variants),
  };
}

export async function fetchSdcComponents(ctx: PluginContext): Promise<SdcComponent[]> {
  const url = `${ctx.baseUrl.replace(/\/+$/, "")}/jsonapi/sdc_component`;
  const req = await ctx.auth.apply({
    method: "GET",
    url,
    headers: { Accept: "application/vnd.api+json" },
  });
  let res: Awaited<ReturnType<typeof ctx.http.send>>;
  try {
    res = await ctx.http.send(req);
  } catch (err) {
    if (err instanceof HttpError) {
      throw new HttpError(
        err.status,
        "Canvas plugin requires Drupal module jsonapi_sdc to build component schemas.",
        err.body,
      );
    }
    throw err;
  }

  const body = JSON.parse(res.body) as { data?: JsonApiSdcResource[] };
  const components = (body.data ?? []).map(normalizeResource).filter((item): item is SdcComponent => item !== null);
  if (components.length === 0) {
    throw new HttpError(
      422,
      "Canvas plugin requires Drupal module jsonapi_sdc to return at least one SDC component.",
      body,
    );
  }
  return components;
}
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
npm --prefix plugins/canvas test -- tests/unit/sdc-client.test.ts
```

Expected: all SDC client tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add plugins/canvas/src/sdc-client.ts plugins/canvas/tests/unit/sdc-client.test.ts
git commit -m "feat: fetch SDC components for Canvas schemas"
```

## Task 6: Build the Canvas Schema Extension

**Files:**
- Create: `plugins/canvas/src/canvas-schema.ts`
- Create: `plugins/canvas/tests/unit/canvas-schema.test.ts`

- [ ] **Step 1: Write failing schema builder tests**

Create `plugins/canvas/tests/unit/canvas-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extendCanvasSchema } from "../../src/canvas-schema.js";
import type { SdcComponent } from "../../src/sdc-client.js";

const baseSchema = {
  $schema: "https://json-schema.org/draft-07/schema",
  type: "object",
  properties: {
    data: {
      type: "object",
      properties: {
        type: { const: "canvas_page--canvas_page" },
        attributes: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
          required: [],
        },
      },
      required: ["type"],
    },
  },
  required: ["data"],
};

const teaser: SdcComponent = {
  id: "olivero:teaser",
  jsonapiId: "olivero--teaser",
  name: "Teaser",
  description: "A teaser component.",
  status: "stable",
  provider: "olivero",
  props: {
    type: "object",
    properties: {
      title: { type: "string", title: "Title" },
    },
  },
  slots: {
    content: { title: "Content" },
  },
  variants: {},
};

describe("extendCanvasSchema", () => {
  it("adds Canvas component payload structure and metadata", () => {
    const schema = extendCanvasSchema(baseSchema, "create", [teaser]) as any;

    const attrs = schema.properties.data.properties.attributes;
    const componentItem = attrs.properties.components.items;

    expect(schema["x-dropsh-builder"]).toBe("canvas");
    expect(schema["x-dropsh-components"]).toEqual([
      {
        id: "sdc.olivero.teaser",
        source_id: "olivero:teaser",
        name: "Teaser",
        description: "A teaser component.",
        provider: "olivero",
        status: "stable",
        props: teaser.props,
        slots: teaser.slots,
        variants: teaser.variants,
      },
    ]);
    expect(attrs.properties.components.type).toBe("array");
    expect(componentItem.required).toEqual(["uuid", "component_id", "inputs"]);
    expect(componentItem.properties.component_id.enum).toEqual(["sdc.olivero.teaser"]);
    expect(componentItem.properties.slot.description).toContain("content");
    expect(componentItem.properties.inputs.oneOf[0].properties.title.type).toBe("string");
  });

  it("marks id as required only for update schemas", () => {
    const schema = extendCanvasSchema(baseSchema, "update", [teaser]) as any;
    expect(schema.properties.data.required).toEqual(["type", "id"]);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm --prefix plugins/canvas test -- tests/unit/canvas-schema.test.ts
```

Expected: fails because `src/canvas-schema.ts` does not exist.

- [ ] **Step 3: Implement the schema builder**

Create `plugins/canvas/src/canvas-schema.ts`:

```ts
import type { SchemaOperation } from "dropsh/plugin";
import type { SdcComponent } from "./sdc-client.js";
import { toCanvasComponentId } from "./sdc-client.js";

function cloneSchema(schema: unknown): Record<string, any> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, any>;
}

function ensureObjectProperty(parent: Record<string, any>, key: string): Record<string, any> {
  parent.properties ??= {};
  parent.properties[key] ??= { type: "object", properties: {}, required: [] };
  parent.properties[key].properties ??= {};
  parent.properties[key].required ??= [];
  return parent.properties[key];
}

function slotNames(components: SdcComponent[]): string[] {
  return [...new Set(components.flatMap((component) => Object.keys(component.slots)))].sort();
}

function componentInputVariants(components: SdcComponent[]): unknown[] {
  return components.map((component) => ({
    type: "object",
    description: `Inputs for ${toCanvasComponentId(component.id)} (${component.name})`,
    ...(Object.keys(component.props).length > 0 ? component.props : { properties: {}, additionalProperties: true }),
  }));
}

export function extendCanvasSchema(
  baseSchema: unknown,
  operation: SchemaOperation,
  components: SdcComponent[],
): unknown {
  const schema = cloneSchema(baseSchema);
  const data = ensureObjectProperty(schema, "data");
  if (operation === "update") data.required = ["type", "id"];

  const attributes = ensureObjectProperty(data, "attributes");
  const ids = components.map((component) => toCanvasComponentId(component.id)).sort();
  const slots = slotNames(components);

  attributes.properties.components = {
    type: "array",
    description: "Canvas component tree. Root components use parent_uuid=null and slot=null. Child components set parent_uuid to another component uuid and slot to one of the parent's slot names.",
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        uuid: { type: "string", format: "uuid" },
        component_id: { type: "string", enum: ids },
        parent_uuid: { type: ["string", "null"], format: "uuid" },
        slot: {
          type: ["string", "null"],
          description: slots.length > 0 ? `Valid known slot names: ${slots.join(", ")}` : "No SDC slots were reported by jsonapi_sdc.",
        },
        inputs: {
          oneOf: componentInputVariants(components),
        },
        label: { type: ["string", "null"] },
      },
      required: ["uuid", "component_id", "inputs"],
    },
  };

  schema["x-dropsh-builder"] = "canvas";
  schema["x-dropsh-components"] = components.map((component) => ({
    id: toCanvasComponentId(component.id),
    source_id: component.id,
    name: component.name,
    description: component.description,
    provider: component.provider,
    status: component.status,
    props: component.props,
    slots: component.slots,
    variants: component.variants,
  }));

  return schema;
}
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
npm --prefix plugins/canvas test -- tests/unit/canvas-schema.test.ts
```

Expected: all Canvas schema builder tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add plugins/canvas/src/canvas-schema.ts plugins/canvas/tests/unit/canvas-schema.test.ts
git commit -m "feat: build Canvas component schema extensions"
```

## Task 7: Wire the Canvas Plugin to SDC Fetching

**Files:**
- Modify: `plugins/canvas/src/index.ts`
- Modify: `plugins/canvas/tests/unit/index.test.ts`

- [ ] **Step 1: Replace plugin tests with Canvas target behavior**

Update `plugins/canvas/tests/unit/index.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { HttpError, type PluginContext } from "dropsh/plugin";
import { canvasPlugin } from "../../src/index.js";

function ctx(body: unknown, status = 200): PluginContext {
  return {
    http: {
      send: vi.fn(async () => {
        if (status >= 200 && status < 300) {
          return { status, headers: {}, body: JSON.stringify(body) };
        }
        throw new HttpError(status, `HTTP ${status}`, body);
      }),
    },
    auth: { apply: async (req) => req },
    baseUrl: "https://example.com",
  };
}

const baseSchema = {
  type: "object",
  properties: {
    data: {
      type: "object",
      properties: {
        type: { const: "canvas_page--canvas_page" },
        attributes: { type: "object", properties: {}, required: [] },
      },
      required: ["type"],
    },
  },
  required: ["data"],
};

const sdcResponse = {
  data: [
    {
      type: "sdc_component--sdc_component",
      id: "olivero--teaser",
      attributes: {
        drupal_internal__id: "olivero:teaser",
        name: "Teaser",
        description: "A teaser component.",
        status: "stable",
        provider: "olivero",
        props: { type: "object", properties: { title: { type: "string" } } },
        slots: { content: { title: "Content" } },
        variants: {},
      },
    },
  ],
};

describe("canvasPlugin", () => {
  it("declares Canvas and jsonapi_sdc as required modules", () => {
    const plugin = canvasPlugin();
    expect(plugin.id).toBe("canvas");
    expect(plugin.requiredModules).toEqual(["canvas", "jsonapi_sdc"]);
  });

  it("leaves pre-operation schemas unchanged", async () => {
    const schema = { type: "object" };
    const result = await canvasPlugin().extendSchema("canvas_page", "canvas_page", schema, {} as any);
    expect(result).toBe(schema);
  });

  it("extends only canvas_page/canvas_page operation schemas", async () => {
    const plugin = canvasPlugin();
    const context = ctx(sdcResponse);

    const unchanged = await plugin.extendOperationSchema!("node", "article", "create", baseSchema, context);
    expect(unchanged).toBe(baseSchema);

    const extended = await plugin.extendOperationSchema!("canvas_page", "canvas_page", "create", baseSchema, context) as any;
    expect(extended["x-dropsh-builder"]).toBe("canvas");
    expect(extended["x-dropsh-components"][0].id).toBe("sdc.olivero.teaser");
  });

  it("throws a clear error when jsonapi_sdc cannot be loaded for Canvas", async () => {
    const plugin = canvasPlugin();
    const context = ctx("not found", 404);

    await expect(
      plugin.extendOperationSchema!("canvas_page", "canvas_page", "create", baseSchema, context),
    ).rejects.toMatchObject({
      code: "E_HTTP",
      message: "Canvas plugin requires Drupal module jsonapi_sdc to build component schemas.",
    });
  });
});
```

- [ ] **Step 2: Run the tests and verify target behavior fails**

Run:

```bash
npm --prefix plugins/canvas test -- tests/unit/index.test.ts
```

Expected: the Canvas enrichment test fails because `index.ts` still returns the schema unchanged.

- [ ] **Step 3: Wire plugin implementation**

Replace `plugins/canvas/src/index.ts` with:

```ts
import type { DrupalCliPlugin } from "dropsh/plugin";
import { extendCanvasSchema } from "./canvas-schema.js";
import { fetchSdcComponents } from "./sdc-client.js";

export function canvasPlugin(): DrupalCliPlugin {
  return {
    id: "canvas",
    requiredModules: ["canvas", "jsonapi_sdc"],
    async extendSchema(_entityType, _bundle, schema) {
      return schema;
    },
    async extendOperationSchema(entityType, bundle, operation, schema, ctx) {
      if (entityType !== "canvas_page" || bundle !== "canvas_page") return schema;
      const components = await fetchSdcComponents(ctx);
      return extendCanvasSchema(schema, operation, components);
    },
  };
}
```

- [ ] **Step 4: Run all Canvas unit tests**

Run:

```bash
npm --prefix plugins/canvas test
```

Expected: all Canvas plugin tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add plugins/canvas/src/index.ts plugins/canvas/tests/unit/index.test.ts
git commit -m "feat: extend Canvas schemas with SDC metadata"
```

## Task 8: Add Canvas Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the README section**

Add this section after the existing schema command documentation in `README.md`:

```markdown
### Canvas schema plugin

Canvas support lives in `@dropsh/plugin-canvas` and requires these Drupal modules:

- `canvas`
- `jsonapi_sdc`

Register the plugin in `dropsh.config.js`:

```js
import { basicAuthPlugin } from "dropsh";
import { canvasPlugin } from "@dropsh/plugin-canvas";

export default {
  site: { base_url: "https://my-drupal.example.com", jsonapi_prefix: "/jsonapi" },
  plugins: [
    basicAuthPlugin({ username: process.env.DRUPAL_USER, password: process.env.DRUPAL_PASSWORD }),
    canvasPlugin(),
  ],
};
```

Then ask for the Canvas schema:

```bash
dropsh schema canvas_page/canvas_page --for=create
```

The returned JSON Schema includes `x-dropsh-builder: "canvas"`, `x-dropsh-components`, and a typed `attributes.components` array. If `jsonapi_sdc` is missing or inaccessible, the Canvas schema fails instead of returning incomplete component information.
```

- [ ] **Step 2: Verify the README renders as Markdown**

Run:

```bash
rg -n "Canvas schema plugin|@dropsh/plugin-canvas|x-dropsh-builder" README.md
```

Expected: all three search terms are present in the new section.

- [ ] **Step 3: Commit**

Run:

```bash
git add README.md
git commit -m "docs: document Canvas schema plugin"
```

## Task 9: Add Integration Fixture Support

**Files:**
- Modify: `tests/integrations/drupal/composer.json`
- Create or modify: `tests/integrations/drupal/fixtures/setup-canvas.php`

- [ ] **Step 1: Add Drupal packages**

Modify `tests/integrations/drupal/composer.json` so the `require` block includes:

```json
"drupal/canvas": "^1.3",
"drupal/jsonapi_sdc": "^1.0",
"drupal/jsonapi_resources": "^1.2"
```

Keep the existing required packages unchanged.

- [ ] **Step 2: Validate composer JSON**

Run:

```bash
python3 -m json.tool tests/integrations/drupal/composer.json >/dev/null && echo valid
```

Expected: prints `valid`.

- [ ] **Step 3: Add Canvas fixture script**

Create `tests/integrations/drupal/fixtures/setup-canvas.php` if it does not exist. If it exists from the spike, replace its contents with:

```php
<?php

declare(strict_types=1);

use Drupal\user\RoleInterface;

user_role_grant_permissions(RoleInterface::ANONYMOUS_ID, ['access sdc components']);
user_role_grant_permissions('authenticated', ['access sdc components']);

$components = \Drupal::service('plugin.manager.sdc')->getDefinitions();
echo 'SDC components available: ' . count($components) . PHP_EOL;
foreach (array_slice(array_keys($components), 0, 10) as $component_id) {
  echo '  component: ' . $component_id . PHP_EOL;
}

echo "Canvas setup complete\n";
```

- [ ] **Step 4: Commit**

Run:

```bash
git add tests/integrations/drupal/composer.json tests/integrations/drupal/fixtures/setup-canvas.php
git commit -m "test: add Canvas Drupal fixture dependencies"
```

## Task 10: Add Canvas Schema Integration Test

**Files:**
- Create: `tests/integrations/schema/canvas-schema.integration.test.ts`

- [ ] **Step 1: Write the integration test**

Create `tests/integrations/schema/canvas-schema.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { testConfig } from "../helpers/config.js";

async function runCliWithCanvasPlugin(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const cfg = testConfig();
  const dir = mkdtempSync(join(tmpdir(), "dropsh-canvas-it-"));
  const cfgPath = join(dir, "dropsh.config.mjs");
  const basicUrl = pathToFileURL(resolve("src/core/auth/basic.js")).href;
  const canvasUrl = pathToFileURL(resolve("plugins/canvas/src/index.js")).href;

  writeFileSync(
    cfgPath,
    [
      `import { basicAuthPlugin } from ${JSON.stringify(basicUrl)};`,
      `import { canvasPlugin } from ${JSON.stringify(canvasUrl)};`,
      "",
      "export default {",
      `  site: { base_url: ${JSON.stringify(cfg.url)}, jsonapi_prefix: "/jsonapi" },`,
      "  defaults: { dry_run: false, timeout_ms: 30000 },",
      "  plugins: [",
      `    basicAuthPlugin({ username: ${JSON.stringify(cfg.basic.user)}, password: ${JSON.stringify(cfg.basic.pass)} }),`,
      "    canvasPlugin(),",
      "  ],",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );

  return await new Promise((resolveResult) => {
    const child = spawn("node", ["--import", "tsx/esm", "bin/dropsh-src", ...args], {
      env: {
        ...process.env,
        DROPSH_CONFIG: cfgPath,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      resolveResult({ code: code ?? -1, stdout, stderr });
    });
  });
}

describe("Canvas schema integration", () => {
  it("includes Canvas component metadata from jsonapi_sdc", async () => {
    const result = await runCliWithCanvasPlugin([
      "schema",
      "canvas_page/canvas_page",
      "--for=create",
      "--refresh",
    ]);

    expect(result.code).toBe(0);
    const schema = JSON.parse(result.stdout);
    expect(schema["x-dropsh-builder"]).toBe("canvas");
    expect(schema["x-dropsh-components"].length).toBeGreaterThan(0);
    expect(schema.properties.data.properties.attributes.properties.components.type).toBe("array");
  });
});
```

- [ ] **Step 2: Run the integration test against DDEV**

Start or rebuild the Drupal fixture:

```bash
npm run drupal:up
```

Then enable Canvas modules and run the fixture:

```bash
cd tests/integrations/drupal
ddev composer require drupal/canvas:^1.3 drupal/jsonapi_sdc:^1.0 drupal/jsonapi_resources:^1.2 --no-interaction
ddev drush en -y canvas jsonapi_sdc jsonapi_resources
ddev drush php:script fixtures/setup-canvas.php
cd ../../..
```

Run:

```bash
npm run test:integration -- tests/integrations/schema/canvas-schema.integration.test.ts
```

Expected: the test passes and the emitted schema contains `x-dropsh-builder: "canvas"`.

- [ ] **Step 3: Commit**

Run:

```bash
git add tests/integrations/schema/canvas-schema.integration.test.ts
git commit -m "test: verify Canvas schema integration"
```

## Task 11: Final Verification

**Files:** all changed files

- [ ] **Step 1: Run unit tests**

Run:

```bash
npm test
```

Expected: all unit tests pass.

- [ ] **Step 2: Run Canvas plugin tests**

Run:

```bash
npm --prefix plugins/canvas test
```

Expected: all Canvas plugin tests pass.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: TypeScript passes.

- [ ] **Step 4: Run plugin build**

Run:

```bash
npm run build:plugins
```

Expected: Schemata, OAuth2, and Canvas plugin builds pass.

- [ ] **Step 5: Run integration test if DDEV is available**

Run:

```bash
npm run test:integration -- tests/integrations/schema/canvas-schema.integration.test.ts
```

Expected: Canvas schema integration test passes. If DDEV is unavailable, record the exact startup or environment failure in the final implementation notes.

- [ ] **Step 6: Inspect final diff**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: no uncommitted tracked changes remain. Recent commits include the Canvas plugin implementation commits from this plan.
