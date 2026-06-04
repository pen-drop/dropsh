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

const inactiveDisplayResponse = {
  data: [
    {
      type: "entity_view_display--entity_view_display",
      id: "display-uuid",
      attributes: {
        drupal_internal__id: "node.article.default",
        third_party_settings: {},
      },
    },
  ],
};

const activeDisplayResponse = {
  data: [
    {
      type: "entity_view_display--entity_view_display",
      id: "display-uuid",
      attributes: {
        drupal_internal__id: "node.article.teaser",
        third_party_settings: {
          display_builder: {
            profile: "default",
            override_profile: "content",
            override_field: "field_display_builder",
            sources: [{ source_id: "component" }],
          },
        },
      },
    },
  ],
};

const profileResponse = {
  data: [
    {
      type: "display_builder_profile--display_builder_profile",
      id: "profile-uuid",
      attributes: {
        drupal_internal__id: "default",
        label: "Default",
        islands: {
          component_library: { status: true },
        },
      },
    },
  ],
};

const overrideProfileResponse = {
  data: [
    {
      type: "display_builder_profile--display_builder_profile",
      id: "override-profile-uuid",
      attributes: {
        drupal_internal__id: "content",
        label: "Content",
      },
    },
  ],
};

const computedMetadataResponse = {
  enabled: true,
  entity_type: "node",
  bundle: "article",
  view_mode: "teaser",
  instance_id: "node.article.teaser",
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
};

describe("fetchDisplayBuilderMetadata", () => {
  it("fetches entity view display through standard JSON:API first", async () => {
    const context = ctx([{ status: 200, body: JSON.stringify({ data: [] }) }]);

    await fetchDisplayBuilderMetadata(context, "node", "article");

    const request = {
      method: "GET",
      url: "https://example.com/jsonapi/entity_view_display/entity_view_display?filter%5Bdrupal_internal__id%5D=node.article.default",
      headers: { Accept: "application/vnd.api+json" },
    };
    expect(context.auth.apply).toHaveBeenCalledWith(request);
    expect(context.http.send).toHaveBeenCalledWith(request);
  });

  it("returns inactive metadata when the entity view display is not found", async () => {
    const context = ctx([{ status: 200, body: JSON.stringify({ data: [] }) }]);

    await expect(fetchDisplayBuilderMetadata(context, "node", "article")).resolves.toEqual({
      enabled: false,
    });
  });

  it("returns inactive metadata when the entity view display has no Display Builder profile", async () => {
    const context = ctx([{ status: 200, body: JSON.stringify(inactiveDisplayResponse) }]);

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

  it("normalizes active metadata from entity view display, profile, and computed endpoint", async () => {
    const context = ctx([
      {
        status: 200,
        body: JSON.stringify(activeDisplayResponse),
      },
      {
        status: 200,
        body: JSON.stringify(profileResponse),
      },
      {
        status: 200,
        body: JSON.stringify(overrideProfileResponse),
      },
      {
        status: 200,
        body: JSON.stringify(computedMetadataResponse),
      },
    ]);

    await expect(
      fetchDisplayBuilderMetadata(context, "node", "article", "teaser"),
    ).resolves.toEqual({
      enabled: true,
      entityType: "node",
      bundle: "article",
      viewMode: "teaser",
      profile: { id: "default", label: "Default" },
      overrideField: "field_display_builder",
      overrideProfile: { id: "content", label: "Content" },
      instanceId: "node.article.teaser",
      sourceTree: [{ source_id: "component" }],
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

  it("throws a patch diagnostic when the computed metadata endpoint is missing", async () => {
    const context = ctx([
      { status: 200, body: JSON.stringify(activeDisplayResponse) },
      { status: 200, body: JSON.stringify(profileResponse) },
      { status: 200, body: JSON.stringify(overrideProfileResponse) },
      { status: 404, body: "not found" },
    ]);

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
      { status: 200, body: JSON.stringify(activeDisplayResponse) },
      { status: 200, body: JSON.stringify(profileResponse) },
      { status: 200, body: JSON.stringify(overrideProfileResponse) },
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
