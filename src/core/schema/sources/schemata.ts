import { HttpError } from "../../../errors.js";
import type { AuthAdapter } from "../../auth/types.js";
import type { HttpClient } from "../../http.js";

export const SCHEMATA_MISS = Symbol("SCHEMATA_MISS");

export interface SchemataDeps {
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  entity: string;
  bundle: string;
}

export async function fetchSchemata(deps: SchemataDeps): Promise<unknown | typeof SCHEMATA_MISS> {
  const base = deps.baseUrl.replace(/\/+$/, "");
  const url = `${base}/schemata/${deps.entity}/${deps.bundle}?_format=schema_json&_describes=api_json`;
  const req = await deps.auth.apply({
    method: "GET",
    url,
    headers: { Accept: "application/json" },
  });
  let res: Awaited<ReturnType<typeof deps.http.send>>;
  try {
    res = await deps.http.send(req);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return SCHEMATA_MISS;
    throw err;
  }
  return JSON.parse(res.body);
}
