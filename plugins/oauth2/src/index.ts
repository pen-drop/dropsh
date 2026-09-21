import type { DropSHPlugin } from "dropsh/plugin";
import { ConfigError } from "dropsh/plugin";
import { oauth2Provider } from "./provider.js";

/**
 * Fields common to every oauth2 profile. `id` decouples the profile identity
 * from `type` (the grant-flow selector), so two profiles of the same grant flow
 * (e.g. two `client_credentials` with different scopes) can coexist. `default`
 * marks the fallback profile when none is active/selected.
 */
interface OAuth2Common {
  /** Profile id (defaults to `type` for backward compatibility). */
  id?: string;
  /** Fallback profile when none is active or explicitly selected. */
  default?: boolean;
}

export type OAuth2Config = OAuth2Common &
  (
    | {
        type: "oauth2_password";
        client_id: string;
        username: string;
        token_url: string;
        scope?: string;
        client_secret?: string;
      }
    | {
        type: "oauth2_client_credentials";
        client_id: string;
        token_url: string;
        scope?: string;
        client_secret?: string;
      }
    | {
        type: "oauth2_authcode";
        client_id: string;
        token_url: string;
        scope?: string;
        redirect_port?: number;
      }
  );

/**
 * `token_url` is composed by the consumer's config as `${base_url}/oauth/token`,
 * so a trailing slash on `base_url` yields `https://host//oauth/token`. That URL
 * never reaches the token endpoint — a proxy collapses or redirects the empty
 * segment — and the server's reply names no cause. Reject the shape before any
 * request is issued, since `token_url` arrives pre-composed and never passes
 * through `loadConfig` (DROPSH-13).
 *
 * The check reads the *path*, never the whole string: the `//` in `https://` is
 * the scheme separator and must not be mistaken for the defect. A `token_url`
 * that does not parse as an absolute URL is left to the request layer.
 */
function assertCanonicalTokenUrl(tokenUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(tokenUrl);
  } catch {
    return;
  }
  if (!parsed.pathname.includes("//")) return;
  parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/");
  throw new ConfigError(
    `oauth2Plugin: token_url must not contain an empty path segment — set it to ${parsed.href}`,
  );
}

function validate(config: OAuth2Config): OAuth2Config {
  if (!config.client_id) throw new ConfigError("oauth2Plugin: client_id required");
  if (!config.token_url) throw new ConfigError("oauth2Plugin: token_url required");
  assertCanonicalTokenUrl(config.token_url);
  if (config.type === "oauth2_password" && !config.username)
    throw new ConfigError("oauth2Plugin: username required for oauth2_password");
  return config;
}

export function oauth2Plugin(config: OAuth2Config): DropSHPlugin {
  const cfg = validate(config);
  return {
    // Derive the plugin id from the profile id so two profiles (e.g. session +
    // pm) are distinct plugins, not collapsed by the resolver's emit-dedup.
    // Provider identity stays `cfg.id` (see oauth2Provider), so profile
    // selection is unchanged (DROPSH-12).
    id: cfg.id ? `oauth2:${cfg.id}` : "oauth2",
    requiredModules: ["simple_oauth"],
    authProvider: oauth2Provider(cfg),
    async extendSchema(_entityType, _bundle, schema, _ctx) {
      return schema;
    },
  };
}
