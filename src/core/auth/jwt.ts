import type { AuthConfig } from "../config.js";
import type { HttpRequest } from "../http.js";
import { AuthError } from "../../errors.js";
import type { AuthAdapter } from "./types.js";

export function createJwtAuth(cfg: AuthConfig): AuthAdapter {
  const token = cfg.token;
  if (typeof token !== "string" || token.length === 0) {
    throw new AuthError("jwt auth requires token");
  }
  return {
    async apply(req: HttpRequest): Promise<HttpRequest> {
      return { ...req, headers: { ...(req.headers ?? {}), Authorization: `Bearer ${token}` } };
    },
  };
}
