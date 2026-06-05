import type { PluginContext } from "dropsh/plugin";
import { HttpError } from "dropsh/plugin";

interface JsonApiComponentResource {
  attributes?: {
    drupal_internal__id?: unknown;
    active_version?: unknown;
    status?: unknown;
  };
}

interface JsonApiComponentResponse {
  data?: JsonApiComponentResource[];
  links?: { next?: { href?: string } };
}

/**
 * Fetches the Canvas `Component` config entities and returns a map of
 * component config id (e.g. "sdc.olivero.teaser") to its active version
 * hash. The server validates `component_version` on every component tree
 * item against this hash, so payloads cannot be built without it.
 */
export async function fetchComponentVersions(ctx: PluginContext): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  let url: string | null = `${ctx.baseUrl.replace(/\/+$/, "")}/jsonapi/component/component`;

  while (url) {
    const request = await ctx.auth.apply({
      method: "GET",
      url,
      headers: { Accept: "application/vnd.api+json" },
    });

    let response: Awaited<ReturnType<PluginContext["http"]["send"]>>;
    try {
      response = await ctx.http.send(request);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        throw new HttpError(
          error.status,
          "Drupal module canvas is required to fetch component versions.",
          error.body,
        );
      }
      throw error;
    }

    let body: JsonApiComponentResponse;
    try {
      body = JSON.parse(response.body) as JsonApiComponentResponse;
    } catch {
      throw new HttpError(502, "Invalid JSON:API response from component endpoint.", response.body);
    }

    for (const resource of body.data ?? []) {
      const id = resource.attributes?.drupal_internal__id;
      const version = resource.attributes?.active_version;
      if (typeof id === "string" && typeof version === "string" && version.length > 0) {
        versions.set(id, version);
      }
    }

    url = body.links?.next?.href ?? null;
  }

  return versions;
}
