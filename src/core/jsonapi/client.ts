import type { DrupalJsonApiParams } from "drupal-jsonapi-params";
import { HttpError } from "../../errors.js";
import type { AuthAdapter } from "../auth/types.js";
import type { HttpClient } from "../http.js";
import { type Collection, createCollection } from "./collection.js";
import { type JsonApiResourceObject, type Resource, toResource } from "./resource.js";
import { resolveType } from "./types.js";

/** Attributes/relationships payload accepted by create/update/upsert. */
export interface ResourceWriteBody {
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}

export interface JsonApiClient {
  get(path: string, params?: DrupalJsonApiParams): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
  patch(path: string, body: unknown): Promise<unknown>;
  delete(path: string): Promise<unknown>;
  upload(path: string, filename: string, data: Uint8Array | Buffer): Promise<unknown>;

  // --- Ergonomic layer (additive; the methods above are unchanged) ---

  /** Start a fluent query for the given resource type. */
  collection(type: string): Collection;
  /** Fetch a single resource by id. */
  resource(type: string, id: string): Promise<Resource>;
  /** Create a resource (POST `{ data: { type, ...body } }`). */
  create(type: string, body: ResourceWriteBody): Promise<Resource>;
  /** Update a resource (PATCH `{ data: { type, id, ...body } }`). */
  update(type: string, id: string, body: ResourceWriteBody): Promise<Resource>;
  /** Update the resource matching `match`, or create one if none exists. */
  upsert(
    type: string,
    match: { path: string; value: string },
    body: ResourceWriteBody,
  ): Promise<Resource>;
  /** Resolve the current authenticated user's uuid from the root document. */
  me(): Promise<string>;
}

export interface JsonApiOptions {
  baseUrl: string;
  prefix: string;
  http: HttpClient;
  auth: AuthAdapter;
}

function joinUrl(base: string, prefix: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = prefix.startsWith("/") ? prefix : `/${prefix}`;
  const r = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}${r}`;
}

const JSONAPI_HEADERS = {
  Accept: "application/vnd.api+json",
  "Content-Type": "application/vnd.api+json",
};

export function createJsonApiClient(opts: JsonApiOptions): JsonApiClient {
  async function send(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    body?: string | Uint8Array,
    extraHeaders: Record<string, string> = {},
  ): Promise<unknown> {
    const reqBase = {
      method,
      url,
      headers: { ...JSONAPI_HEADERS, ...extraHeaders },
    };
    const req = body !== undefined ? { ...reqBase, body } : reqBase;
    let res: Awaited<ReturnType<HttpClient["send"]>>;
    try {
      res = await opts.http.send(await opts.auth.apply(req));
    } catch (err) {
      // The server rejected the token (401). Ask the auth adapter to renew and,
      // if it could, retry the request exactly once with a fresh token.
      if (!(err instanceof HttpError) || err.status !== 401 || !opts.auth.renew) throw err;
      const renewed = await opts.auth.renew();
      if (!renewed) throw err;
      res = await opts.http.send(await opts.auth.apply(req));
    }
    if (res.status === 204 || res.body.length === 0) return { ok: true };
    return JSON.parse(res.body) as unknown;
  }

  const client: JsonApiClient = {
    async get(path, params) {
      const qs = params ? `?${params.getQueryString()}` : "";
      return send("GET", joinUrl(opts.baseUrl, opts.prefix, path) + qs);
    },
    async post(path, body) {
      return send("POST", joinUrl(opts.baseUrl, opts.prefix, path), JSON.stringify(body));
    },
    async patch(path, body) {
      return send("PATCH", joinUrl(opts.baseUrl, opts.prefix, path), JSON.stringify(body));
    },
    async delete(path) {
      return send("DELETE", joinUrl(opts.baseUrl, opts.prefix, path));
    },
    async upload(path, filename, data) {
      return send("POST", joinUrl(opts.baseUrl, opts.prefix, path), data, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `file; filename="${filename}"`,
      });
    },

    collection(type) {
      return createCollection(client, type);
    },

    async resource(type, id) {
      const { path } = resolveType(type);
      const doc = (await client.get(`${path}/${id}`)) as { data: JsonApiResourceObject };
      return toResource(doc.data);
    },

    async create(type, body) {
      const { path, type: resourceType } = resolveType(type);
      const doc = (await client.post(path, {
        data: { type: resourceType, ...body },
      })) as { data: JsonApiResourceObject };
      return toResource(doc.data);
    },

    async update(type, id, body) {
      const { path, type: resourceType } = resolveType(type);
      const doc = (await client.patch(`${path}/${id}`, {
        data: { type: resourceType, id, ...body },
      })) as { data: JsonApiResourceObject };
      return toResource(doc.data);
    },

    async upsert(type, match, body) {
      const existing = await client.collection(type).where(match.path, "=", match.value).first();
      if (existing) return client.update(type, existing.id, body);
      return client.create(type, body);
    },

    async me() {
      const doc = (await client.get("")) as {
        meta?: { links?: { me?: { href?: string; meta?: { id?: string } } } };
      };
      const me = doc?.meta?.links?.me;
      if (me?.meta?.id) return me.meta.id;
      if (me?.href) {
        const segment = me.href.split("/").filter(Boolean).pop();
        if (segment) return segment;
      }
      throw new Error("Unable to resolve current user uuid from root document meta.links.me");
    },
  };

  return client;
}
