import type { AuthConfig } from "../config.js";
import type { HttpRequest } from "../http.js";
import { AuthError } from "../../errors.js";
import type { AuthAdapter } from "./types.js";

export function createBasicAuth(cfg: AuthConfig): AuthAdapter {
  const username = cfg.username;
  const password = cfg.password;
  if (typeof username !== "string" || typeof password !== "string") {
    throw new AuthError("basic auth requires username and password");
  }
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  return {
    async apply(req: HttpRequest): Promise<HttpRequest> {
      return { ...req, headers: { ...(req.headers ?? {}), Authorization: `Basic ${token}` } };
    },
  };
}
