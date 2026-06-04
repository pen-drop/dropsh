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
      overrideField: string;
      sources: DisplayBuilderSourceMetadata[];
      allowedComponents: DisplayBuilderComponentMetadata[];
      unsupportedSources: DisplayBuilderUnsupportedSourceMetadata[];
    };

const missingEndpointMessage =
  "Display Builder metadata endpoint is required. Apply or enable the Display Builder schema metadata API patch.";
const missingSourceSchemasMessage =
  "Display Builder metadata is active but does not include source schemas.";
const invalidMetadataMessage = "Display Builder metadata endpoint did not return valid JSON.";
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

/**
 * Fetches Display Builder schema metadata for an entity view display and
 * normalises the Drupal patch endpoint's snake_case response.
 */
export async function fetchDisplayBuilderMetadata(
  ctx: PluginContext,
  entityType: string,
  bundle: string,
  viewMode = "default",
): Promise<DisplayBuilderMetadata> {
  const request = await ctx.auth.apply({
    method: "GET",
    url: `${ctx.baseUrl.replace(/\/+$/, "")}/api/display-builder/schema/entity-view/${entityType}/${bundle}/${viewMode}`,
    headers: { Accept: "application/json" },
  });

  let response: Awaited<ReturnType<PluginContext["http"]["send"]>>;
  try {
    response = await ctx.http.send(request);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      throw new HttpError(error.status, missingEndpointMessage, error.body);
    }
    throw error;
  }

  let body: unknown;
  try {
    body = JSON.parse(response.body);
  } catch {
    throw new HttpError(502, invalidMetadataMessage, response.body);
  }

  if (!isObject(body)) {
    throw new HttpError(502, invalidMetadataObjectMessage, body);
  }

  const metadata = body;
  if (metadata.enabled !== true) {
    return { enabled: false };
  }

  const rawSources = asArray(metadata.sources);
  if (rawSources.length === 0 || rawSources.some((source) => !hasSchema(source))) {
    throw new HttpError(422, missingSourceSchemasMessage, metadata);
  }

  return {
    enabled: true,
    entityType: asString(metadata.entity_type, entityType),
    bundle: asString(metadata.bundle, bundle),
    viewMode: asString(metadata.view_mode, viewMode),
    overrideField: asString(metadata.override_field),
    sources: rawSources.map((source) => normalizeSource(source)),
    allowedComponents: asArray(metadata.allowed_components).map((component) =>
      normalizeComponent(component),
    ),
    unsupportedSources: asArray(metadata.unsupported_sources).map((source) =>
      normalizeUnsupportedSource(source),
    ),
  };
}
