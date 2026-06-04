import { type DropSHPlugin, HttpError, type PluginContext } from "dropsh/plugin";
import { describe, expect, it, vi } from "vitest";
import { displayBuilderPlugin } from "../../src/index.js";

type ExtendOperationSchema = NonNullable<DropSHPlugin["extendOperationSchema"]>;

function ctx(responses: Array<{ status: number; body: string }>): PluginContext {
  let i = 0;
  return {
    http: {
      send: vi.fn(async () => {
        const r = responses[i];
        if (!r) {
          throw new Error(`Unexpected HTTP request #${i + 1}: no queued test response.`);
        }
        i += 1;
        if (r.status >= 200 && r.status < 300) {
          return { status: r.status, headers: {}, body: r.body };
        }
        throw new HttpError(r.status, `HTTP ${r.status}`, r.body);
      }),
    },
    auth: { apply: vi.fn(async (req) => req) },
    baseUrl: "https://example.com",
  };
}

function requireExtendOperationSchema(plugin: DropSHPlugin): ExtendOperationSchema {
  const extendOperationSchema = plugin.extendOperationSchema;
  expect(extendOperationSchema).toBeDefined();
  if (!extendOperationSchema) {
    throw new Error("Expected displayBuilderPlugin to define extendOperationSchema.");
  }
  return extendOperationSchema;
}

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  expect(Array.isArray(value)).toBe(true);
  return value as unknown[];
}

function recordProperty(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  return asRecord(parent[key]);
}

const operationSchema = {
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
          },
        },
      },
      required: ["type"],
    },
  },
  required: ["data"],
};

const activeMetadataResponse = {
  enabled: true,
  entity_type: "node",
  bundle: "article",
  view_mode: "default",
  override_field: "field_display_builder_override",
  sources: [
    {
      id: "component",
      label: "Component",
      source_type: "component",
      schema: { type: "object" },
    },
  ],
  allowed_components: [
    {
      id: "olivero:teaser",
      source_id: "olivero:teaser",
      name: "Teaser",
      schema: { type: "object" },
    },
  ],
  unsupported_sources: [],
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
        props: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
        },
        slots: {
          content: { title: "Content" },
        },
        variants: {},
      },
    },
  ],
};

describe("displayBuilderPlugin", () => {
  it("requires Display Builder and JSON:API SDC Drupal modules", () => {
    const plugin = displayBuilderPlugin();

    expect(plugin.id).toBe("display-builder");
    expect(plugin.requiredModules).toEqual([
      "display_builder",
      "display_builder_entity_view",
      "jsonapi_sdc",
    ]);
  });

  it("passes pre-operation schema through unchanged", async () => {
    const plugin = displayBuilderPlugin();
    const context = ctx([]);
    const schema = { type: "object" };

    await expect(plugin.extendSchema("node", "article", schema, context)).resolves.toBe(schema);
  });

  it("fetches inactive metadata and returns operation schemas unchanged without fetching SDC", async () => {
    const plugin = displayBuilderPlugin();
    const extendOperationSchema = requireExtendOperationSchema(plugin);
    const context = ctx([{ status: 200, body: JSON.stringify({ enabled: false }) }]);
    const schema = { type: "object" };

    await expect(extendOperationSchema("node", "article", "create", schema, context)).resolves.toBe(
      schema,
    );

    expect(context.http.send).toHaveBeenCalledTimes(1);
    expect(context.auth.apply).toHaveBeenCalledWith({
      method: "GET",
      url: "https://example.com/api/display-builder/schema/entity-view/node/article/default",
      headers: { Accept: "application/json" },
    });
  });

  it("fetches active metadata and SDC, then enriches operation schemas", async () => {
    const plugin = displayBuilderPlugin();
    const extendOperationSchema = requireExtendOperationSchema(plugin);
    const context = ctx([
      { status: 200, body: JSON.stringify(activeMetadataResponse) },
      { status: 200, body: JSON.stringify(sdcResponse) },
    ]);

    const schema = asRecord(
      await extendOperationSchema("node", "article", "create", operationSchema, context),
    );
    const components = asArray(schema["x-dropsh-components"]);
    const component = asRecord(components[0]);
    const properties = recordProperty(schema, "properties");
    const data = recordProperty(recordProperty(properties, "data"), "properties");
    const attributes = recordProperty(recordProperty(data, "attributes"), "properties");
    const overrideField = recordProperty(attributes, "field_display_builder_override");
    const items = recordProperty(overrideField, "items");
    const oneOf = asArray(items.oneOf);
    const variantProperties = recordProperty(asRecord(oneOf[0]), "properties");
    const sourceProperties = recordProperty(
      recordProperty(variantProperties, "source"),
      "properties",
    );
    const componentProperties = recordProperty(
      recordProperty(sourceProperties, "component"),
      "properties",
    );
    const componentId = recordProperty(componentProperties, "component_id");

    expect(context.http.send).toHaveBeenCalledTimes(2);
    expect(schema).not.toBe(operationSchema);
    expect(schema["x-dropsh-builder"]).toBe("display-builder");
    expect(component.id).toBe("olivero:teaser");
    expect(componentId.enum).toEqual(["olivero:teaser"]);
  });

  it("propagates the metadata endpoint 404 diagnostic unchanged", async () => {
    const plugin = displayBuilderPlugin();
    const extendOperationSchema = requireExtendOperationSchema(plugin);
    const context = ctx([{ status: 404, body: "not found" }]);

    await expect(
      extendOperationSchema("node", "article", "create", operationSchema, context),
    ).rejects.toMatchObject({
      code: "E_HTTP",
      status: 404,
      body: "not found",
      message:
        "Display Builder metadata endpoint is required. Apply or enable the Display Builder schema metadata API patch.",
    });
  });

  it("propagates a clear missing module message when jsonapi_sdc returns 404", async () => {
    const plugin = displayBuilderPlugin();
    const extendOperationSchema = requireExtendOperationSchema(plugin);
    const context = ctx([
      { status: 200, body: JSON.stringify(activeMetadataResponse) },
      { status: 404, body: "not found" },
    ]);

    await expect(
      extendOperationSchema("node", "article", "create", operationSchema, context),
    ).rejects.toMatchObject({
      code: "E_HTTP",
      status: 404,
      body: "not found",
      message:
        "Display Builder plugin requires Drupal module jsonapi_sdc to build component schemas.",
    });
  });

  it("throws 422 when active metadata references components unknown to jsonapi_sdc", async () => {
    const plugin = displayBuilderPlugin();
    const extendOperationSchema = requireExtendOperationSchema(plugin);
    const context = ctx([
      {
        status: 200,
        body: JSON.stringify({
          ...activeMetadataResponse,
          allowed_components: [
            ...activeMetadataResponse.allowed_components,
            {
              id: "missing:id",
              source_id: "missing:id",
              name: "Missing",
              schema: { type: "object" },
            },
          ],
        }),
      },
      { status: 200, body: JSON.stringify(sdcResponse) },
    ]);

    await expect(
      extendOperationSchema("node", "article", "create", operationSchema, context),
    ).rejects.toMatchObject({
      code: "E_HTTP",
      status: 422,
      message: "Display Builder metadata references components unknown to jsonapi_sdc: missing:id",
    });
  });
});
