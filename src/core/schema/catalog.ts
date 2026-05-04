import { HttpError } from "../../errors.js";
import type { AuthAdapter } from "../auth/types.js";
import type { HttpClient } from "../http.js";

export interface CatalogEntry {
  entity_type: string;
  bundle: string;
  label: string;
}

export interface CatalogDeps {
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  jsonapiPrefix: string;
}

function prettify(machine: string): string {
  const spaced = machine.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export async function fetchCatalog(deps: CatalogDeps): Promise<CatalogEntry[]> {
  const url = `${deps.baseUrl.replace(/\/+$/, "")}${deps.jsonapiPrefix.startsWith("/") ? deps.jsonapiPrefix : `/${deps.jsonapiPrefix}`}`;
  const req = await deps.auth.apply({
    method: "GET",
    url,
    headers: { Accept: "application/vnd.api+json" },
  });
  const res = await deps.http.send(req);
  if (res.status < 200 || res.status >= 300) {
    throw new HttpError(res.status, `cannot reach ${url}: HTTP ${res.status}`, res.body);
  }
  const body = JSON.parse(res.body) as {
    links?: Record<string, { href?: string; meta?: { title?: string } }>;
  };
  const links = body.links ?? {};
  const out: CatalogEntry[] = [];
  for (const [key, link] of Object.entries(links)) {
    if (!key.includes("--")) continue;
    // key.includes("--") guard above ensures two segments exist.
    const [entity_type, bundle] = key.split("--", 2) as [string, string];
    const label = link?.meta?.title ?? prettify(bundle);
    out.push({ entity_type, bundle, label });
  }
  return out;
}
