import { describe, expect, it, vi } from "vitest";
import { HttpError, type PluginContext } from "dropsh/plugin";
import { canvasPlugin } from "../../src/index.js";

function ctx(responses: Array<{ status: number; body: string }>): PluginContext {
  let i = 0;
  return {
    http: {
      send: vi.fn(async () => {
        const r = responses[i++]!;
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

const operationSchema = {
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
        },
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

describe("canvasPlugin", () => {
  it("requires Canvas and JSON:API SDC Drupal modules", () => {
    const plugin = canvasPlugin();

    expect(plugin.id).toBe("canvas");
    expect(plugin.requiredModules).toEqual(["canvas", "jsonapi_sdc"]);
  });

  it("passes pre-operation schema through unchanged", async () => {
    const plugin = canvasPlugin();
    const schema = { type: "object" };

    await expect(plugin.extendSchema("canvas_page", "canvas_page", schema, {} as any)).resolves.toBe(
      schema,
    );
  });

  it("returns unrelated operation target schemas unchanged without fetching SDC", async () => {
    const plugin = canvasPlugin();
    const context = ctx([]);
    const schema = { type: "object" };

    await expect(
      plugin.extendOperationSchema!(
        "node",
        "article",
        "create",
        schema,
        context,
      ),
    ).resolves.toBe(schema);
    expect(context.http.send).not.toHaveBeenCalled();
  });

  it("fetches SDC and enriches canvas_page operation schemas", async () => {
    const plugin = canvasPlugin();
    const context = ctx([{ status: 200, body: JSON.stringify(sdcResponse) }]);

    const schema = (await plugin.extendOperationSchema!(
      "canvas_page",
      "canvas_page",
      "create",
      operationSchema,
      context,
    )) as any;

    expect(context.http.send).toHaveBeenCalledTimes(1);
    expect(schema).not.toBe(operationSchema);
    expect(schema["x-dropsh-builder"]).toBe("canvas");
    expect(schema["x-dropsh-components"][0].id).toBe("sdc.olivero.teaser");
    expect(
      schema.properties.data.properties.attributes.properties.components.items.oneOf[0].properties
        .component_id.const,
    ).toBe("sdc.olivero.teaser");
  });

  it("propagates a clear missing module message when jsonapi_sdc returns 404", async () => {
    const plugin = canvasPlugin();
    const context = ctx([{ status: 404, body: "not found" }]);

    await expect(
      plugin.extendOperationSchema!(
        "canvas_page",
        "canvas_page",
        "create",
        operationSchema,
        context,
      ),
    ).rejects.toMatchObject({
      code: "E_HTTP",
      status: 404,
      body: "not found",
      message: "Canvas plugin requires Drupal module jsonapi_sdc to build component schemas.",
    });
  });
});
