import { HttpError, type PluginContext } from "dropsh/plugin";
import { describe, expect, it, vi } from "vitest";
import { fetchDisplayBuilderMetadata } from "../../src/metadata-client.js";

function ctx(
  responses: Array<{ status: number; body: string }>,
  baseUrl = "https://example.com/",
): PluginContext {
  let i = 0;
  return {
    http: {
      send: vi.fn(async () => {
        const r = responses[i++];
        if (!r) {
          throw new Error("Unexpected metadata client request.");
        }
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

describe("fetchDisplayBuilderMetadata", () => {
  it("fetches the entity-view metadata endpoint with JSON headers through auth", async () => {
    const context = ctx([{ status: 200, body: JSON.stringify({ enabled: false }) }]);

    await fetchDisplayBuilderMetadata(context, "node", "article");

    const request = {
      method: "GET",
      url: "https://example.com/api/display-builder/schema/entity-view/node/article/default",
      headers: { Accept: "application/json" },
    };
    expect(context.auth.apply).toHaveBeenCalledWith(request);
    expect(context.http.send).toHaveBeenCalledWith(request);
  });

  it("normalizes inactive metadata", async () => {
    const context = ctx([{ status: 200, body: JSON.stringify({ enabled: false }) }]);

    await expect(fetchDisplayBuilderMetadata(context, "node", "article")).resolves.toEqual({
      enabled: false,
    });
  });

  it("throws when valid JSON is not a metadata object", async () => {
    const context = ctx([{ status: 200, body: "null" }]);

    await expect(fetchDisplayBuilderMetadata(context, "node", "article")).rejects.toMatchObject({
      code: "E_HTTP",
      status: 502,
      body: null,
      message: "Display Builder metadata endpoint did not return a valid metadata object.",
    });
  });

  it("normalizes active snake_case API metadata", async () => {
    const context = ctx([
      {
        status: 200,
        body: JSON.stringify({
          enabled: true,
          entity_type: "node",
          bundle: "article",
          view_mode: "teaser",
          override_field: "field_display_builder",
          sources: [
            {
              id: "title",
              label: "Title",
              source_type: "base_field",
              schema: { type: "string" },
            },
          ],
          allowed_components: [
            {
              id: "sdc.olivero.teaser",
              source_id: "olivero:teaser",
              name: "Teaser",
              schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                },
              },
            },
          ],
          unsupported_sources: [
            {
              id: "uid",
              label: "Author",
              source_type: "entity_reference",
              reason: "Entity references are not supported.",
            },
          ],
        }),
      },
    ]);

    await expect(
      fetchDisplayBuilderMetadata(context, "node", "article", "teaser"),
    ).resolves.toEqual({
      enabled: true,
      entityType: "node",
      bundle: "article",
      viewMode: "teaser",
      overrideField: "field_display_builder",
      sources: [
        {
          id: "title",
          label: "Title",
          sourceType: "base_field",
          schema: { type: "string" },
        },
      ],
      allowedComponents: [
        {
          id: "sdc.olivero.teaser",
          sourceId: "olivero:teaser",
          name: "Teaser",
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
            },
          },
        },
      ],
      unsupportedSources: [
        {
          id: "uid",
          label: "Author",
          sourceType: "entity_reference",
          reason: "Entity references are not supported.",
        },
      ],
    });
  });

  it("throws a patch diagnostic when the metadata endpoint is missing", async () => {
    const context = ctx([{ status: 404, body: "not found" }]);

    await expect(fetchDisplayBuilderMetadata(context, "node", "article")).rejects.toMatchObject({
      code: "E_HTTP",
      status: 404,
      body: "not found",
      message:
        "Display Builder metadata endpoint is required. Apply or enable the Display Builder schema metadata API patch.",
    });
  });

  it("throws when active metadata does not include source schemas", async () => {
    const context = ctx([
      {
        status: 200,
        body: JSON.stringify({
          enabled: true,
          entity_type: "node",
          bundle: "article",
          view_mode: "default",
          sources: [{ id: "title", label: "Title", source_type: "base_field" }],
          allowed_components: [],
          unsupported_sources: [],
        }),
      },
    ]);

    await expect(fetchDisplayBuilderMetadata(context, "node", "article")).rejects.toMatchObject({
      code: "E_HTTP",
      status: 422,
      message: "Display Builder metadata is active but does not include source schemas.",
    });
  });
});
