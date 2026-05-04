import { AuthError } from "../../errors.js";
import type { AuthConfig } from "../config.js";
import type { HttpClient } from "../http.js";
import { createBasicAuth } from "./basic.js";
import { createOAuth2Auth } from "./oauth2.js";
import { createOAuth2AuthCodeAuth } from "./oauth2-authcode.js";
import type { AuthAdapter } from "./types.js";

export interface AuthFactoryDeps {
  http: HttpClient;
  baseUrl: string;
}

export function createAuthAdapter(cfg: AuthConfig, deps: AuthFactoryDeps): AuthAdapter {
  switch (cfg.type) {
    case "basic":
      return createBasicAuth(cfg);
    case "oauth2_password":
    case "oauth2_client_credentials":
      return createOAuth2Auth(cfg, { http: deps.http, baseUrl: deps.baseUrl });
    case "oauth2_authcode":
      return createOAuth2AuthCodeAuth(cfg, { http: deps.http, baseUrl: deps.baseUrl });
    default:
      throw new AuthError(`Unknown auth.type: ${String(cfg.type)}`);
  }
}
