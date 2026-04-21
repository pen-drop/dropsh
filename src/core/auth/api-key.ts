import type { AuthConfig } from "../config.js";
import type { HttpRequest } from "../http.js";
import { AuthError } from "../../errors.js";
import type { AuthAdapter } from "./types.js";

export function createApiKeyAuth(cfg: AuthConfig): AuthAdapter {
  const key = cfg.key;
  const header = typeof cfg.header === "string" ? cfg.header : "X-API-Key";
  if (typeof key !== "string" || key.length === 0) {
    throw new AuthError("api_key auth requires key");
  }
  return {
    async apply(req: HttpRequest): Promise<HttpRequest> {
      return { ...req, headers: { ...(req.headers ?? {}), [header]: key } };
    },
  };
}
