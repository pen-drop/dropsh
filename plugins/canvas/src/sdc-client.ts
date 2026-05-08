import type { PluginContext } from "../../../src/core/plugin.js";
import { HttpError } from "../../../src/errors.js";

export interface SdcComponent {
  id: string;
  jsonapiId: string;
  name: string;
  description: string;
  status: string;
  provider: string;
  props: Record<string, unknown>;
  slots: Record<string, unknown>;
  variants: Record<string, unknown>;
}

interface JsonApiSdcResource {
  id?: unknown;
  attributes?: {
    drupal_internal__id?: unknown;
    name?: unknown;
    description?: unknown;
    status?: unknown;
    provider?: unknown;
    props?: unknown;
    slots?: unknown;
    variants?: unknown;
  };
}

interface JsonApiSdcResponse {
  data?: unknown;
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function toCanvasComponentId(sdcId: string): string {
  const [provider, name] = sdcId.split(":", 2);
  if (!provider || !name) {
    return `sdc.${sdcId.replace(/:/g, ".")}`;
  }
  return `sdc.${provider}.${name}`;
}

function normalizeResource(resource: JsonApiSdcResource): SdcComponent | null {
  const attributes = resource.attributes ?? {};
  const id = asString(attributes.drupal_internal__id, "");
  if (!id.includes(":")) {
    return null;
  }

  const provider = asString(attributes.provider, id.split(":", 1)[0] ?? "");
  return {
    id,
    jsonapiId: asString(resource.id, id.replace(/:/g, "--")),
    name: asString(attributes.name, id),
    description: asString(attributes.description, ""),
    status: asString(attributes.status, "stable"),
    provider,
    props: asObject(attributes.props),
    slots: asObject(attributes.slots),
    variants: asObject(attributes.variants),
  };
}

export async function fetchSdcComponents(ctx: PluginContext): Promise<SdcComponent[]> {
  const request = await ctx.auth.apply({
    method: "GET",
    url: `${ctx.baseUrl.replace(/\/+$/, "")}/jsonapi/sdc_component`,
    headers: { Accept: "application/vnd.api+json" },
  });

  let response: Awaited<ReturnType<PluginContext["http"]["send"]>>;
  try {
    response = await ctx.http.send(request);
  } catch (error) {
    if (error instanceof HttpError) {
      throw new HttpError(
        error.status,
        "Canvas plugin requires Drupal module jsonapi_sdc to build component schemas.",
        error.body,
      );
    }
    throw error;
  }

  const body = JSON.parse(response.body) as JsonApiSdcResponse;
  const resources = Array.isArray(body.data) ? body.data : [];
  const components = resources
    .map((resource) => normalizeResource(asObject(resource)))
    .filter((component): component is SdcComponent => component !== null);

  if (components.length === 0) {
    throw new HttpError(
      422,
      "Canvas plugin requires Drupal module jsonapi_sdc to return at least one SDC component.",
      body,
    );
  }

  return components;
}
