import { HttpError, type PluginContext } from "dropsh/plugin";

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

const invalidJsonApiMessage = "jsonapi_sdc did not return a valid JSON:API document.";

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * Normalises a Drupal SDC id (e.g. "olivero:teaser") into the dotted form
 * used by dropsh schemas: "sdc.<provider>.<name>".
 */
export function toSdcComponentId(sdcId: string): string {
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

/**
 * Fetches all SDC components from the Drupal jsonapi_sdc endpoint and
 * returns them as a normalised list. Throws a `404 HttpError` with a clear
 * message if jsonapi_sdc is not installed, and `502`/`422` HttpErrors for
 * malformed or empty responses.
 */
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
    if (error instanceof HttpError && error.status === 404) {
      throw new HttpError(
        error.status,
        "Drupal module jsonapi_sdc is required to fetch SDC components.",
        error.body,
      );
    }
    throw error;
  }

  let body: unknown;
  try {
    body = JSON.parse(response.body);
  } catch {
    throw new HttpError(502, invalidJsonApiMessage, response.body);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(502, invalidJsonApiMessage, body);
  }

  const jsonApiBody = body as JsonApiSdcResponse;
  const resources = Array.isArray(jsonApiBody.data) ? jsonApiBody.data : [];
  const components = resources
    .map((resource) => normalizeResource(asObject(resource)))
    .filter((component): component is SdcComponent => component !== null);

  if (components.length === 0) {
    throw new HttpError(
      422,
      "jsonapi_sdc returned no SDC components.",
      jsonApiBody,
    );
  }

  return components;
}
