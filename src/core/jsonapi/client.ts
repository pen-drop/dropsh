import type { DrupalJsonApiParams } from "drupal-jsonapi-params";
import type { AuthAdapter } from "../auth/types.js";
import type { HttpClient } from "../http.js";
import type { JsonApiDocument } from "./types.js";

export interface JsonApiClient {
  get(path: string, params?: DrupalJsonApiParams): Promise<JsonApiDocument>;
  post(path: string, body: unknown): Promise<JsonApiDocument>;
  patch(path: string, body: unknown): Promise<JsonApiDocument>;
  delete(path: string): Promise<{ ok: true }>;
  upload(
    path: string,
    filename: string,
    data: Uint8Array | Buffer,
  ): Promise<{ ok: true } | JsonApiDocument>;
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
    const withAuth = await opts.auth.apply(req);
    const res = await opts.http.send(withAuth);
    if (res.status === 204 || res.body.length === 0) return { ok: true };
    return JSON.parse(res.body) as unknown;
  }

  return {
    async get(path, params) {
      const qs = params ? `?${params.getQueryString()}` : "";
      return send("GET", joinUrl(opts.baseUrl, opts.prefix, path) + qs) as Promise<JsonApiDocument>;
    },
    async post(path, body) {
      return send(
        "POST",
        joinUrl(opts.baseUrl, opts.prefix, path),
        JSON.stringify(body),
      ) as Promise<JsonApiDocument>;
    },
    async patch(path, body) {
      return send(
        "PATCH",
        joinUrl(opts.baseUrl, opts.prefix, path),
        JSON.stringify(body),
      ) as Promise<JsonApiDocument>;
    },
    async delete(path) {
      return send("DELETE", joinUrl(opts.baseUrl, opts.prefix, path)) as Promise<{ ok: true }>;
    },
    async upload(path, filename, data) {
      return send("POST", joinUrl(opts.baseUrl, opts.prefix, path), data, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `file; filename="${filename}"`,
      }) as Promise<{ ok: true } | JsonApiDocument>;
    },
  };
}
