import { HttpError, type PluginContext } from "dropsh/plugin";

export interface DisplayBuilderSourceMetadata {
  id: string;
  label: string;
  sourceType: string;
  schema: Record<string, unknown>;
}

export interface DisplayBuilderComponentMetadata {
  id: string;
  sourceId: string;
  name: string;
  schema: Record<string, unknown>;
}

interface DisplayBuilderUnsupportedSourceMetadata {
  id: string;
  label: string;
  sourceType: string;
  reason: string;
}

export type DisplayBuilderMetadata =
  | { enabled: false }
  | {
      enabled: true;
      entityType: string;
      bundle: string;
      viewMode: string;
      profile?: unknown;
      overrideField: string;
      overrideProfile?: unknown;
      instanceId?: string;
      sourceTree?: unknown;
      sources: DisplayBuilderSourceMetadata[];
      allowedComponents: DisplayBuilderComponentMetadata[];
      unsupportedSources: DisplayBuilderUnsupportedSourceMetadata[];
    };

const missingEndpointMessage =
  "Display Builder metadata endpoint is required. Apply or enable the Display Builder schema metadata API patch.";
const missingSourceSchemasMessage =
  "Display Builder metadata is active but does not include source schemas.";
const invalidJsonMessage = "Display Builder metadata endpoint did not return valid JSON.";
const invalidMetadataObjectMessage =
  "Display Builder metadata endpoint did not return a valid metadata object.";

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

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((item) => asObject(item)) : [];
}

function normalizeSource(source: Record<string, unknown>): DisplayBuilderSourceMetadata {
  return {
    id: asString(source.id),
    label: asString(source.label),
    sourceType: asString(source.source_type),
    schema: asObject(source.schema),
  };
}

function normalizeComponent(component: Record<string, unknown>): DisplayBuilderComponentMetadata {
  return {
    id: asString(component.id),
    sourceId: asString(component.source_id),
    name: asString(component.name),
    schema: asObject(component.schema),
  };
}

function normalizeUnsupportedSource(
  source: Record<string, unknown>,
): DisplayBuilderUnsupportedSourceMetadata {
  return {
    id: asString(source.id),
    label: asString(source.label),
    sourceType: asString(source.source_type),
    reason: asString(source.reason),
  };
}

function hasSchema(source: Record<string, unknown>): boolean {
  return (
    typeof source.schema === "object" && source.schema !== null && !Array.isArray(source.schema)
  );
}

async function fetchJson(
  ctx: PluginContext,
  url: string,
  notFoundMessage?: string,
): Promise<Record<string, unknown>> {
  const request = await ctx.auth.apply({
    method: "GET",
    url,
    headers: { Accept: "application/vnd.api+json" },
  });

  let response: Awaited<ReturnType<PluginContext["http"]["send"]>>;
  try {
    response = await ctx.http.send(request);
  } catch (error) {
    if (notFoundMessage && error instanceof HttpError && error.status === 404) {
      throw new HttpError(error.status, notFoundMessage, error.body);
    }
    throw error;
  }

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

async function fetchComputedMetadata(
  ctx: PluginContext,
  entityType: string,
  bundle: string,
  viewMode: string,
): Promise<Record<string, unknown>> {
  const baseUrl = ctx.baseUrl.replace(/\/+$/, "");
  return await fetchJson(
    ctx,
    `${baseUrl}/api/display-builder/schema/entity-view/${entityType}/${bundle}/${viewMode}`,
    missingEndpointMessage,
  );
}

/**
 * Fetches Display Builder schema metadata for an entity view display and
 * normalises standard JSON:API config resources plus computed Display Builder
 * metadata from the Drupal patch endpoint.
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
  const overrideProfileId = asString(displayBuilderSettings.override_profile);
  const overrideProfile =
    overrideProfileId && overrideProfileId !== profileId
      ? await fetchJsonApiConfigResource(ctx, "display_builder_profile", overrideProfileId)
      : profile;

  const computed = await fetchComputedMetadata(ctx, entityType, bundle, viewMode);
  if (computed.enabled !== true) {
    return { enabled: false };
  }

  const metadata = computed;
  const rawSources = asArray(metadata.sources);
  if (rawSources.length === 0 || rawSources.some((source) => !hasSchema(source))) {
    throw new HttpError(422, missingSourceSchemasMessage, metadata);
  }

  return {
    enabled: true,
    entityType: asString(metadata.entity_type, entityType),
    bundle: asString(metadata.bundle, bundle),
    viewMode: asString(metadata.view_mode, viewMode),
    profile: {
      id: profileId,
      label: asString(profile.label, profileId),
    },
    overrideField: asString(displayBuilderSettings.override_field),
    ...(overrideProfileId
      ? {
          overrideProfile: {
            id: overrideProfileId,
            label: asString(overrideProfile?.label, overrideProfileId),
          },
        }
      : {}),
    ...(asString(metadata.instance_id) ? { instanceId: asString(metadata.instance_id) } : {}),
    ...(displayBuilderSettings.sources !== undefined
      ? { sourceTree: displayBuilderSettings.sources }
      : {}),
    sources: rawSources.map((source) => normalizeSource(source)),
    allowedComponents: asArray(metadata.allowed_components).map((component) =>
      normalizeComponent(component),
    ),
    unsupportedSources: asArray(metadata.unsupported_sources).map((source) =>
      normalizeUnsupportedSource(source),
    ),
  };
}
