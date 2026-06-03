import type { DropSHPlugin } from "dropsh/plugin";
import { ConfigError } from "dropsh/plugin";
import { oauth2Provider } from "./provider.js";

export type OAuth2Config =
  | {
      type: "oauth2_password";
      client_id: string;
      username: string;
      token_url: string;
      scope?: string;
    }
  | {
      type: "oauth2_client_credentials";
      client_id: string;
      token_url: string;
      scope?: string;
    }
  | {
      type: "oauth2_authcode";
      client_id: string;
      token_url: string;
      scope?: string;
      redirect_port?: number;
    };

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
    id: "oauth2",
    requiredModules: ["simple_oauth"],
    authProvider: oauth2Provider(cfg),
    async extendSchema(_entityType, _bundle, schema, _ctx) {
      return schema;
    },
  };
}
