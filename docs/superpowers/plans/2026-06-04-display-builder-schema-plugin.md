# Display Builder Schema Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@dropsh/plugin-display-builder`, extending `dropsh schema` with field-specific Display Builder source-tree metadata from Drupal entity view display configuration.

**Architecture:** Add a new workspace plugin mirroring `plugins/canvas`. The plugin fetches Display Builder entity-view metadata first, returns inactive targets unchanged, fetches `jsonapi_sdc` only for active writable displays, and extends the configured override field with component/source-aware JSON Schema.

**Tech Stack:** TypeScript 5.6, pnpm workspaces, Vitest, Ajv, existing `dropsh/plugin` API, existing `@dropsh/sdc-client`.

---

## File Structure

- `plugins/display-builder/package.json` - workspace package metadata and scripts.
- `plugins/display-builder/tsconfig.json` - TypeScript config matching Canvas.
- `plugins/display-builder/vitest.config.ts` - plugin test config.
- `plugins/display-builder/README.md` - usage and required Drupal-side metadata API.
- `plugins/display-builder/src/metadata-client.ts` - fetch and normalize Display Builder metadata.
- `plugins/display-builder/src/schema.ts` - pure schema extension logic.
- `plugins/display-builder/src/index.ts` - public `displayBuilderPlugin()` factory and orchestration.
- `plugins/display-builder/tests/unit/metadata-client.test.ts` - client tests.
- `plugins/display-builder/tests/unit/schema.test.ts` - schema-extender tests.
- `plugins/display-builder/tests/unit/index.test.ts` - plugin orchestration tests.
- `playground/db/dropsh.config.js` - register plugin for the DB playground after package exists.
- `tests/integrations/schema/display-builder-schema.integration.test.ts` - optional integration coverage once metadata endpoint exists in fixture.

## Task 1: Scaffold Package and Metadata Client

**Files:**
- Create: `plugins/display-builder/package.json`
- Create: `plugins/display-builder/tsconfig.json`
- Create: `plugins/display-builder/vitest.config.ts`
- Create: `plugins/display-builder/src/metadata-client.ts`
- Create: `plugins/display-builder/tests/unit/metadata-client.test.ts`

- [ ] **Step 1: Write metadata client tests**

Create `plugins/display-builder/tests/unit/metadata-client.test.ts`:

```ts
import { HttpError, type PluginContext } from "dropsh/plugin";
import { describe, expect, it, vi } from "vitest";
import { fetchDisplayBuilderMetadata } from "../../src/metadata-client.js";

function ctx(response: { status: number; body: string }): PluginContext {
  return {
    http: {
      send: vi.fn(async () => {
        if (response.status >= 200 && response.status < 300) {
          return { status: response.status, headers: {}, body: response.body };
        }
        throw new HttpError(response.status, `HTTP ${response.status}`, response.body);
      }),
    },
    auth: { apply: vi.fn(async (req) => req) },
    baseUrl: "https://example.com/",
  };
}

describe("fetchDisplayBuilderMetadata", () => {
  it("fetches the entity-view metadata endpoint with default view mode", async () => {
    const context = ctx({
      status: 200,
      body: JSON.stringify({ enabled: false }),
    });

    await fetchDisplayBuilderMetadata(context, "node", "article", "default");

    expect(context.auth.apply).toHaveBeenCalledWith({
      method: "GET",
      url: "https://example.com/api/display-builder/schema/entity-view/node/article/default",
      headers: { Accept: "application/json" },
    });
  });

  it("normalizes inactive metadata", async () => {
    const metadata = await fetchDisplayBuilderMetadata(
      ctx({ status: 200, body: JSON.stringify({ enabled: false }) }),
      "node",
      "article",
      "default",
    );

    expect(metadata).toEqual({ enabled: false });
  });

  it("normalizes active metadata", async () => {
    const metadata = await fetchDisplayBuilderMetadata(
      ctx({
        status: 200,
        body: JSON.stringify({
          enabled: true,
          entity_type: "node",
          bundle: "article",
          view_mode: "default",
          profile: { id: "default", label: "Default" },
          override_field: "field_display_builder_override",
          components: [{ id: "olivero:teaser", label: "Teaser" }],
          sources: [
            {
              id: "component",
              label: "Component",
              schema: { type: "object", properties: { component_id: { type: "string" } } },
            },
          ],
          unsupported_sources: ["block"],
        }),
      }),
      "node",
      "article",
      "default",
    );

    expect(metadata).toMatchObject({
      enabled: true,
      entityType: "node",
      bundle: "article",
      viewMode: "default",
      profile: { id: "default", label: "Default" },
      overrideField: "field_display_builder_override",
      allowedComponents: [{ id: "olivero:teaser", label: "Teaser" }],
      sources: [{ id: "component", label: "Component" }],
      unsupportedSources: ["block"],
    });
  });

  it("throws a patch diagnostic when the endpoint is missing", async () => {
    await expect(
      fetchDisplayBuilderMetadata(ctx({ status: 404, body: "not found" }), "node", "article"),
    ).rejects.toMatchObject({
      status: 404,
      message:
        "Display Builder metadata endpoint is required. Apply or enable the Display Builder schema metadata API patch.",
    });
  });

  it("throws on active metadata without source schema data", async () => {
    await expect(
      fetchDisplayBuilderMetadata(
        ctx({
          status: 200,
          body: JSON.stringify({
            enabled: true,
            entity_type: "node",
            bundle: "article",
            view_mode: "default",
            profile: { id: "default", label: "Default" },
            override_field: "field_display_builder_override",
            components: [{ id: "olivero:teaser" }],
            sources: [{ id: "component", label: "Component" }],
          }),
        }),
        "node",
        "article",
      ),
    ).rejects.toMatchObject({
      status: 422,
      message: "Display Builder metadata is active but does not include source schemas.",
    });
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter ./plugins/display-builder test
```

Expected: fails because the package and `metadata-client.ts` do not exist.

- [ ] **Step 3: Create package files**

Create `plugins/display-builder/package.json`:

```json
{
  "name": "@dropsh/plugin-display-builder",
  "version": "0.0.2",
  "type": "module",
  "main": "./dist/plugins/display-builder/src/index.js",
  "exports": {
    ".": "./dist/plugins/display-builder/src/index.js"
  },
  "files": ["dist/plugins/display-builder/src", "README.md"],
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "pnpm run build"
  },
  "peerDependencies": {
    "dropsh": "*"
  },
  "dependencies": {
    "@dropsh/sdc-client": "workspace:*"
  },
  "devDependencies": {
    "dropsh": "workspace:*",
    "typescript": "^5.6.0",
    "vitest": "^4.1.8"
  }
}
```

Create `plugins/display-builder/tsconfig.json`:

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

Create `plugins/display-builder/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 4: Implement metadata client**

Create `plugins/display-builder/src/metadata-client.ts`:

```ts
import { HttpError, type PluginContext } from "dropsh/plugin";

export interface DisplayBuilderSourceMetadata {
  id: string;
  label: string;
  schema: Record<string, unknown>;
}

export interface DisplayBuilderComponentMetadata {
  id: string;
  label: string;
}

export type DisplayBuilderMetadata =
  | { enabled: false }
  | {
      enabled: true;
      entityType: string;
      bundle: string;
      viewMode: string;
      profile: { id: string; label: string };
      overrideField: string;
      overrideProfile?: { id: string; label: string };
      instanceId?: string;
      sourceTree?: unknown;
      allowedComponents: DisplayBuilderComponentMetadata[];
      sources: DisplayBuilderSourceMetadata[];
      unsupportedSources: string[];
    };

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizeProfile(value: unknown): { id: string; label: string } {
  const profile = asRecord(value);
  const id = asString(profile.id);
  return { id, label: asString(profile.label, id) };
}

function normalizeActive(body: Record<string, unknown>): DisplayBuilderMetadata {
  const sources = Array.isArray(body.sources)
    ? body.sources.map((source) => {
        const item = asRecord(source);
        return {
          id: asString(item.id),
          label: asString(item.label, asString(item.id)),
          schema: asRecord(item.schema),
        };
      })
    : [];

  if (sources.length === 0 || sources.some((source) => Object.keys(source.schema).length === 0)) {
    throw new HttpError(422, "Display Builder metadata is active but does not include source schemas.", body);
  }

  return {
    enabled: true,
    entityType: asString(body.entity_type),
    bundle: asString(body.bundle),
    viewMode: asString(body.view_mode, "default"),
    profile: normalizeProfile(body.profile),
    overrideField: asString(body.override_field),
    overrideProfile: body.override_profile ? normalizeProfile(body.override_profile) : undefined,
    instanceId: asString(body.instance_id) || undefined,
    sourceTree: body.source_tree,
    allowedComponents: Array.isArray(body.components)
      ? body.components.map((component) => {
          const item = asRecord(component);
          return { id: asString(item.id), label: asString(item.label, asString(item.id)) };
        })
      : [],
    sources,
    unsupportedSources: Array.isArray(body.unsupported_sources)
      ? body.unsupported_sources.map((source) => asString(source)).filter(Boolean)
      : [],
  };
}

export async function fetchDisplayBuilderMetadata(
  ctx: PluginContext,
  entityType: string,
  bundle: string,
  viewMode = "default",
): Promise<DisplayBuilderMetadata> {
  const baseUrl = ctx.baseUrl.replace(/\/+$/, "");
  const request = await ctx.auth.apply({
    method: "GET",
    url: `${baseUrl}/api/display-builder/schema/entity-view/${entityType}/${bundle}/${viewMode}`,
    headers: { Accept: "application/json" },
  });

  let response: Awaited<ReturnType<PluginContext["http"]["send"]>>;
  try {
    response = await ctx.http.send(request);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      throw new HttpError(
        404,
        "Display Builder metadata endpoint is required. Apply or enable the Display Builder schema metadata API patch.",
        error.body,
      );
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw new HttpError(502, "Display Builder metadata endpoint did not return valid JSON.", response.body);
  }

  const body = asRecord(parsed);
  if (body.enabled !== true) {
    return { enabled: false };
  }

  return normalizeActive(body);
}
```

- [ ] **Step 5: Run metadata client tests**

Run:

```bash
pnpm --filter ./plugins/display-builder test -- tests/unit/metadata-client.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/display-builder
git commit -m "feat(display-builder): add metadata client"
```

## Task 2: Build Pure Schema Extender

**Files:**
- Create: `plugins/display-builder/src/schema.ts`
- Create: `plugins/display-builder/tests/unit/schema.test.ts`

- [ ] **Step 1: Write schema tests**

Create `plugins/display-builder/tests/unit/schema.test.ts` with tests for unchanged inactive metadata, override-field extension, component filtering, source variants, metadata, deep cloning, and Ajv compilation.

Use this fixture inside the test file:

```ts
const baseSchema = {
  type: "object",
  properties: {
    data: {
      type: "object",
      properties: {
        type: { const: "node--article" },
        attributes: {
          type: "object",
          properties: {
            title: { type: "string" },
            field_display_builder_override: { type: "object" },
          },
        },
      },
      required: ["type"],
    },
  },
  required: ["data"],
};
```

Assert that the extended schema contains:

```ts
expect(schema["x-dropsh-builder"]).toBe("display-builder");
expect(schema["x-dropsh-display-builder"].override_field).toBe("field_display_builder_override");
expect(field.items.oneOf[0].properties.source_id.const).toBe("component");
expect(componentId.enum).toEqual(["olivero:teaser"]);
expect(schema["x-dropsh-sources"][0].id).toBe("component");
```

- [ ] **Step 2: Run schema tests and verify they fail**

Run:

```bash
pnpm --filter ./plugins/display-builder test -- tests/unit/schema.test.ts
```

Expected: fails because `src/schema.ts` does not exist.

- [ ] **Step 3: Implement schema extender**

Create `plugins/display-builder/src/schema.ts`:

```ts
import type { SdcComponent } from "@dropsh/sdc-client";
import type { DisplayBuilderMetadata } from "./metadata-client.js";

type JsonSchemaObject = Record<string, any>;

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ensureObjectProperty(parent: JsonSchemaObject, key: string): JsonSchemaObject {
  parent.properties ??= {};
  parent.properties[key] ??= { type: "object" };
  const child = parent.properties[key] as JsonSchemaObject;
  child.type ??= "object";
  child.properties ??= {};
  return child;
}

function componentSourceSchema(allowedIds: string[]): JsonSchemaObject {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      source_id: { type: "string", const: "component" },
      source: {
        type: "object",
        additionalProperties: false,
        properties: {
          component: {
            type: "object",
            additionalProperties: true,
            properties: {
              component_id: { type: "string", enum: allowedIds },
              props: { type: "object", additionalProperties: true },
              slots: { type: "object", additionalProperties: true },
            },
            required: ["component_id"],
          },
        },
        required: ["component"],
      },
    },
    required: ["source_id", "source"],
  };
}

export function extendDisplayBuilderSchema(
  baseSchema: unknown,
  metadata: DisplayBuilderMetadata,
  components: SdcComponent[],
): unknown {
  if (!metadata.enabled || !metadata.overrideField) {
    return baseSchema;
  }

  const schema = cloneValue(baseSchema) as JsonSchemaObject;
  const data = ensureObjectProperty(schema, "data");
  const attributes = ensureObjectProperty(data, "attributes");

  const allowedIds = new Set(metadata.allowedComponents.map((component) => component.id));
  const knownComponents = components.filter((component) => allowedIds.has(component.id));
  const variants = metadata.sources
    .filter((source) => source.id === "component")
    .map(() => componentSourceSchema(knownComponents.map((component) => component.id).sort()));

  attributes.properties[metadata.overrideField] = {
    type: "array",
    description: "Display Builder source tree for the configured entity-view override field.",
    items: {
      oneOf: variants,
    },
  };

  schema["x-dropsh-builder"] = "display-builder";
  schema["x-dropsh-display-builder"] = {
    entity_type: metadata.entityType,
    bundle: metadata.bundle,
    view_mode: metadata.viewMode,
    profile: metadata.profile.id,
    override_field: metadata.overrideField,
    override_profile: metadata.overrideProfile?.id,
    instance_id: metadata.instanceId,
    unsupported_sources: cloneValue(metadata.unsupportedSources),
  };
  schema["x-dropsh-components"] = knownComponents.map((component) => ({
    id: component.id,
    name: component.name,
    description: component.description,
    provider: component.provider,
    status: component.status,
    props: cloneValue(component.props),
    slots: cloneValue(component.slots),
    variants: cloneValue(component.variants),
  }));
  schema["x-dropsh-sources"] = cloneValue(metadata.sources);

  return schema;
}
```

- [ ] **Step 4: Run schema tests**

Run:

```bash
pnpm --filter ./plugins/display-builder test -- tests/unit/schema.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/display-builder/src/schema.ts plugins/display-builder/tests/unit/schema.test.ts
git commit -m "feat(display-builder): extend override field schema"
```

## Task 3: Wire Plugin Factory

**Files:**
- Create: `plugins/display-builder/src/index.ts`
- Create: `plugins/display-builder/tests/unit/index.test.ts`
- Create: `plugins/display-builder/README.md`

- [ ] **Step 1: Write plugin tests**

Create `plugins/display-builder/tests/unit/index.test.ts` modeled after `plugins/canvas/tests/unit/index.test.ts`.

Required assertions:

```ts
expect(plugin.id).toBe("display-builder");
expect(plugin.requiredModules).toEqual(["display_builder", "display_builder_entity_view", "jsonapi_sdc"]);
await expect(plugin.extendSchema("node", "article", schema, ctx)).resolves.toBe(schema);
expect(inactiveContext.http.send).toHaveBeenCalledTimes(1);
expect(activeContext.http.send).toHaveBeenCalledTimes(2);
expect(result["x-dropsh-builder"]).toBe("display-builder");
```

Include a 404 metadata endpoint test expecting:

```ts
message:
  "Display Builder metadata endpoint is required. Apply or enable the Display Builder schema metadata API patch."
```

- [ ] **Step 2: Run plugin tests and verify they fail**

Run:

```bash
pnpm --filter ./plugins/display-builder test -- tests/unit/index.test.ts
```

Expected: fails because `src/index.ts` does not exist.

- [ ] **Step 3: Implement plugin factory**

Create `plugins/display-builder/src/index.ts`:

```ts
import { fetchSdcComponents } from "@dropsh/sdc-client";
import type { DropSHPlugin } from "dropsh/plugin";
import { HttpError } from "dropsh/plugin";
import { fetchDisplayBuilderMetadata } from "./metadata-client.js";
import { extendDisplayBuilderSchema } from "./schema.js";

export function displayBuilderPlugin(): DropSHPlugin {
  return {
    id: "display-builder",
    requiredModules: ["display_builder", "display_builder_entity_view", "jsonapi_sdc"],
    async extendSchema(_entityType, _bundle, schema) {
      return schema;
    },
    async extendOperationSchema(entityType, bundle, _operation, schema, ctx) {
      const metadata = await fetchDisplayBuilderMetadata(ctx, entityType, bundle, "default");
      if (!metadata.enabled || !metadata.overrideField) {
        return schema;
      }

      try {
        const components = await fetchSdcComponents(ctx);
        return extendDisplayBuilderSchema(schema, metadata, components);
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) {
          throw new HttpError(
            404,
            "Display Builder plugin requires Drupal module jsonapi_sdc to build component schemas.",
            err.body,
          );
        }
        throw err;
      }
    },
  };
}
```

- [ ] **Step 4: Create README**

Create `plugins/display-builder/README.md`:

```md
# @dropsh/plugin-display-builder

Extends `dropsh schema` for Drupal Display Builder entity-view integrations.

Required Drupal modules:

- `display_builder`
- `display_builder_entity_view`
- `jsonapi_sdc`

The plugin also requires a read-only Display Builder metadata endpoint equivalent to:

```text
GET /api/display-builder/schema/entity-view/{entity_type}/{bundle}/{view_mode}
```

If Display Builder does not provide this endpoint yet, apply the Display Builder metadata API patch used by the integration fixture.
```

- [ ] **Step 5: Run plugin tests**

Run:

```bash
pnpm --filter ./plugins/display-builder test -- tests/unit/index.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/display-builder/src/index.ts plugins/display-builder/tests/unit/index.test.ts plugins/display-builder/README.md
git commit -m "feat(display-builder): add plugin factory"
```

## Task 4: Register Playground and Verify Workspace

**Files:**
- Modify: `playground/db/dropsh.config.js`
- Optional Create: `tests/integrations/schema/display-builder-schema.integration.test.ts`

- [ ] **Step 1: Update playground config**

Modify `playground/db/dropsh.config.js`:

```js
import { displayBuilderPlugin } from "@dropsh/plugin-display-builder";
import { basicAuthPlugin } from "dropsh/plugin";

export default {
  site: {
    base_url: "http://db.dropsh-test.ddev.site",
    jsonapi_prefix: "/jsonapi",
  },
  plugins: [
    basicAuthPlugin({ username: "tester", password: "tester-pw" }),
    displayBuilderPlugin(),
  ],
};
```

- [ ] **Step 2: Run plugin package tests**

Run:

```bash
pnpm --filter ./plugins/display-builder test
```

Expected: all Display Builder plugin unit tests pass.

- [ ] **Step 3: Run build and typecheck**

Run:

```bash
pnpm run build:packages
pnpm --filter ./plugins/display-builder typecheck
pnpm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 4: Run lint**

Run:

```bash
pnpm run lint
```

Expected: exits 0. If Biome reports formatting issues, run `pnpm run lint:fix`, inspect the diff, then rerun `pnpm run lint`.

- [ ] **Step 5: Commit**

```bash
git add playground/db/dropsh.config.js plugins/display-builder
git commit -m "chore(display-builder): register playground plugin"
```

## Task 5: Integration Test After Display Builder Patch Exists

**Files:**
- Create: `tests/integrations/schema/display-builder-schema.integration.test.ts`
- Modify: `tests/integrations/bin/init-db.sh` only if the fixture lacks the metadata API patch or entity-view config setup.

- [ ] **Step 1: Confirm metadata endpoint in DDEV**

Run:

```bash
pnpm run drupal:up
curl -sS http://db.dropsh-test.ddev.site/api/display-builder/schema/entity-view/node/article/default
```

Expected JSON includes:

```json
{
  "enabled": true,
  "entity_type": "node",
  "bundle": "article",
  "view_mode": "default",
  "override_field": "field_display_builder_override"
}
```

- [ ] **Step 2: Add integration test**

Create `tests/integrations/schema/display-builder-schema.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runDropsh } from "../helpers/run.js";

describe("integration: display builder schema", () => {
  it("adds Display Builder metadata to the configured override field", async () => {
    const result = await runDropsh([
      "schema",
      "node/article",
      "--for=create",
      "--config",
      "playground/db/dropsh.config.js",
      "--refresh",
    ]);

    expect(result.status).toBe(0);
    const schema = JSON.parse(result.stdout);

    expect(schema["x-dropsh-builder"]).toBe("display-builder");
    expect(schema["x-dropsh-display-builder"].override_field).toBe(
      "field_display_builder_override",
    );
    expect(
      schema.properties.data.properties.attributes.properties.field_display_builder_override,
    ).toBeDefined();
    expect(schema["x-dropsh-components"].length).toBeGreaterThan(0);
    expect(schema["x-dropsh-sources"].length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run integration test**

Run:

```bash
pnpm run test:integration -- tests/integrations/schema/display-builder-schema.integration.test.ts
```

Expected: passes if the Display Builder metadata API patch and fixture config are present. If the endpoint is missing, keep this test uncommitted and document the missing patch in the final handoff.

- [ ] **Step 4: Commit integration coverage when endpoint exists**

```bash
git add tests/integrations/schema/display-builder-schema.integration.test.ts tests/integrations/bin/init-db.sh
git commit -m "test(display-builder): cover schema integration"
```

## Verification

Run before claiming completion:

```bash
pnpm --filter ./plugins/display-builder test
pnpm run build:packages
pnpm run typecheck
pnpm run lint
```

If the Display Builder metadata API exists in the fixture, also run:

```bash
pnpm run test:integration -- tests/integrations/schema/display-builder-schema.integration.test.ts
```

## Self-Review

Spec coverage:

- Package and plugin factory: Tasks 1 and 3.
- Display Builder metadata endpoint: Task 1.
- SDC reuse and active-only fetch: Task 3.
- Override-field schema extension: Task 2.
- Error behavior: Tasks 1 and 3.
- Playground and integration path: Tasks 4 and 5.

Completeness scan: Tasks 1-4 are fully actionable. Task 5 is intentionally gated by the external Display Builder patch and states the exact command and expected response required before committing integration coverage.

Type consistency: metadata types use `entityType`, `viewMode`, `overrideField`, `allowedComponents`, `unsupportedSources`; schema metadata emits snake_case `x-dropsh-*` values to match JSON output conventions.
