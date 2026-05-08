import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../../../../src/errors.js";
import type { PluginContext } from "../../../../src/core/plugin.js";
import { fetchSdcComponents, toCanvasComponentId } from "../../src/sdc-client.js";

function ctx(
  responses: Array<{ status: number; body: string }>,
  baseUrl = "https://example.com",
): PluginContext {
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
    baseUrl,
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
              id: "invalid",
              attributes: {
                drupal_internal__id: "invalid",
              },
            },
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
  });

  it("requests the jsonapi_sdc endpoint with JSON:API headers", async () => {
    const context = ctx(
      [
        {
          status: 200,
          body: JSON.stringify({
            data: [
              {
                id: "olivero--teaser",
                attributes: { drupal_internal__id: "olivero:teaser" },
              },
            ],
          }),
        },
      ],
      "https://example.com/",
    );

    await fetchSdcComponents(context);

    expect(context.auth.apply).toHaveBeenCalledWith({
      method: "GET",
      url: "https://example.com/jsonapi/sdc_component",
      headers: { Accept: "application/vnd.api+json" },
    });
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
      status: 404,
      body: "not found",
      message: "Canvas plugin requires Drupal module jsonapi_sdc to build component schemas.",
    });
  });

  it("throws a clear error when jsonapi_sdc returns no valid components", async () => {
    const context = ctx([
      {
        status: 200,
        body: JSON.stringify({
          data: [
            {
              id: "invalid",
              attributes: { drupal_internal__id: "invalid" },
            },
          ],
        }),
      },
    ]);

    await expect(fetchSdcComponents(context)).rejects.toMatchObject({
      code: "E_HTTP",
      status: 422,
      body: {
        data: [
          {
            id: "invalid",
            attributes: { drupal_internal__id: "invalid" },
          },
        ],
      },
      message:
        "Canvas plugin requires Drupal module jsonapi_sdc to return at least one SDC component.",
    });
  });
});
