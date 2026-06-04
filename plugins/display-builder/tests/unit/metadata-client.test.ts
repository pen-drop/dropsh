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
        targetEntityType: "node",
        bundle: "article",
        mode: "teaser",
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
          component_library: {
            status: true,
            filters: { provider: ["olivero"] },
          },
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
        islands: {
          component_library: { status: true },
        },
      },
    },
  ],
};
const profileAttributes = profileResponse.data[0]?.attributes;
const overrideProfileAttributes = overrideProfileResponse.data[0]?.attributes;

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

  it("throws when valid JSON is not a JSON:API object", async () => {
    const context = ctx([{ status: 200, body: "null" }]);

    await expect(fetchDisplayBuilderMetadata(context, "node", "article")).rejects.toMatchObject({
      code: "E_HTTP",
      status: 502,
      body: null,
      message: "Display Builder JSON:API config response did not return a valid object.",
    });
  });

  it("normalizes active metadata from entity view display and profiles only", async () => {
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
    ]);

    await expect(
      fetchDisplayBuilderMetadata(context, "node", "article", "teaser"),
    ).resolves.toEqual({
      enabled: true,
      entityType: "node",
      bundle: "article",
      viewMode: "teaser",
      profile: { id: "default", label: "Default" },
      profileConfig: profileAttributes,
      overrideField: "field_display_builder",
      overrideProfile: { id: "content", label: "Content" },
      overrideProfileConfig: overrideProfileAttributes,
      sourceTree: [{ source_id: "component" }],
      componentLibrary: {
        status: true,
        filters: { provider: ["olivero"] },
      },
    });
    expect(context.http.send).toHaveBeenCalledTimes(3);
  });

  it("uses the profile as override profile when both profile ids are equal", async () => {
    const context = ctx([
      {
        status: 200,
        body: JSON.stringify({
          data: [
            {
              attributes: {
                third_party_settings: {
                  display_builder: {
                    profile: "default",
                    override_profile: "default",
                    override_field: "field_display_builder",
                  },
                },
              },
            },
          ],
        }),
      },
      { status: 200, body: JSON.stringify(profileResponse) },
    ]);

    await expect(fetchDisplayBuilderMetadata(context, "node", "article")).resolves.toMatchObject({
      enabled: true,
      overrideProfile: { id: "default", label: "Default" },
      overrideProfileConfig: profileAttributes,
    });
    expect(context.http.send).toHaveBeenCalledTimes(2);
  });
});
