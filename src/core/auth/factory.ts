import type { AuthConfig } from "../config.js";
import type { HttpClient } from "../http.js";
import { AuthError } from "../../errors.js";
import type { AuthAdapter } from "./types.js";
import { createBasicAuth } from "./basic.js";
import { createJwtAuth } from "./jwt.js";
import { createApiKeyAuth } from "./api-key.js";
import { createOAuth2Auth } from "./oauth2.js";

export interface AuthFactoryDeps {
  http: HttpClient;
  baseUrl: string;
}

export function createAuthAdapter(cfg: AuthConfig, deps: AuthFactoryDeps): AuthAdapter {
  switch (cfg.type) {
    case "basic":
      return createBasicAuth(cfg);
    case "jwt":
      return createJwtAuth(cfg);
    case "api_key":
      return createApiKeyAuth(cfg);
    case "oauth2_password":
    case "oauth2_client_credentials":
      return createOAuth2Auth(cfg, { http: deps.http, baseUrl: deps.baseUrl });
    default:
      throw new AuthError(`Unknown auth.type: ${String(cfg.type)}`);
  }
}
