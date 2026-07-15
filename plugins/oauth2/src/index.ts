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

function validate(config: OAuth2Config): OAuth2Config {
  if (!config.client_id) throw new ConfigError("oauth2Plugin: client_id required");
  if (!config.token_url) throw new ConfigError("oauth2Plugin: token_url required");
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
