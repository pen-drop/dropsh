import { HttpError, type PluginContext } from "dropsh/plugin";

export type DisplayBuilderMetadata =
  | { enabled: false }
  | {
      enabled: true;
      entityType: string;
      bundle: string;
      viewMode: string;
      profile?: unknown;
      profileConfig?: unknown;
      overrideField: string;
      overrideProfile?: unknown;
      overrideProfileConfig?: unknown;
      sourceTree?: unknown;
      componentLibrary?: unknown;
    };

const invalidJsonMessage = "Display Builder JSON:API config response did not return valid JSON.";
const invalidMetadataObjectMessage =
  "Display Builder JSON:API config response did not return a valid object.";

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

async function fetchJson(ctx: PluginContext, url: string): Promise<Record<string, unknown>> {
  const request = await ctx.auth.apply({
    method: "GET",
    url,
    headers: { Accept: "application/vnd.api+json" },
  });

  const response = await ctx.http.send(request);

  let body: unknown;
  try {
    body = JSON.parse(response.body);
  } catch {
    throw new HttpError(502, invalidJsonMessage, response.body);
  }

  if (!isObject(body)) {
    throw new HttpError(502, invalidMetadataObjectMessage, body);
  }
  return body;
}

function singleResource(body: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(body.data) || body.data.length === 0) {
    return null;
  }
  return asObject(body.data[0]);
}

async function fetchJsonApiConfigResource(
  ctx: PluginContext,
  resourceType: string,
  internalId: string,
): Promise<Record<string, unknown> | null> {
  const baseUrl = ctx.baseUrl.replace(/\/+$/, "");
  const body = await fetchJson(
    ctx,
    `${baseUrl}/jsonapi/${resourceType}/${resourceType}?filter%5Bdrupal_internal__id%5D=${encodeURIComponent(internalId)}`,
  );
  const resource = singleResource(body);
  return resource ? asObject(resource.attributes) : null;
}

function configLabel(config: Record<string, unknown>, fallback: string): string {
  return asString(config.label, fallback);
}

function profileSummary(id: string, config: Record<string, unknown> | null) {
  return {
    id,
    label: configLabel(config ?? {}, id),
  };
}

/**
 * Fetches Display Builder schema metadata from standard JSON:API config
 * resources: entity_view_display and display_builder_profile.
 */
export async function fetchDisplayBuilderMetadata(
  ctx: PluginContext,
  entityType: string,
  bundle: string,
  viewMode = "default",
): Promise<DisplayBuilderMetadata> {
  const display = await fetchJsonApiConfigResource(
    ctx,
    "entity_view_display",
    `${entityType}.${bundle}.${viewMode}`,
  );
  if (!display) {
    return { enabled: false };
  }

  const displayBuilderSettings = asObject(asObject(display.third_party_settings).display_builder);
  const profileId = asString(displayBuilderSettings.profile);
  if (!profileId) {
    return { enabled: false };
  }

  const profile = await fetchJsonApiConfigResource(ctx, "display_builder_profile", profileId);
  if (!profile) {
    return { enabled: false };
  }

  const overrideProfileId = asString(displayBuilderSettings.override_profile, profileId);
  const overrideProfile =
    overrideProfileId && overrideProfileId !== profileId
      ? await fetchJsonApiConfigResource(ctx, "display_builder_profile", overrideProfileId)
      : profile;
  const componentLibrary = asObject(asObject(profile.islands).component_library);

  return {
    enabled: true,
    entityType: asString(display.targetEntityType, entityType),
    bundle: asString(display.bundle, bundle),
    viewMode: asString(display.mode, viewMode),
    profile: profileSummary(profileId, profile),
    profileConfig: profile,
    overrideField: asString(displayBuilderSettings.override_field),
    ...(overrideProfileId
      ? {
          overrideProfile: profileSummary(overrideProfileId, overrideProfile),
          overrideProfileConfig: overrideProfile,
        }
      : {}),
    ...(displayBuilderSettings.sources !== undefined
      ? { sourceTree: displayBuilderSettings.sources }
      : {}),
    componentLibrary,
  };
}
