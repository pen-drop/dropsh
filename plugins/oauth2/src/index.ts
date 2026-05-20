import type { DropSHPlugin } from "dropsh/plugin";
import { ConfigError } from "dropsh/plugin";
import { createOAuth2Auth } from "./oauth2.js";
import { createOAuth2AuthCodeAuth } from "./oauth2-authcode.js";

export type OAuth2Config =
  | {
      type: "oauth2_password";
      client_id: string;
      client_secret: string;
      username: string;
      password: string;
      token_url: string;
      scope?: string;
    }
  | {
      type: "oauth2_client_credentials";
      client_id: string;
      client_secret: string;
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
  if (config.type === "oauth2_password" || config.type === "oauth2_client_credentials") {
    if (!config.client_secret)
      throw new ConfigError(`oauth2Plugin: client_secret required for ${config.type}`);
  }
  if (config.type === "oauth2_password") {
    if (!config.username)
      throw new ConfigError("oauth2Plugin: username required for oauth2_password");
    if (!config.password)
      throw new ConfigError("oauth2Plugin: password required for oauth2_password");
  }
  return config;
}

export function oauth2Plugin(config: OAuth2Config): DropSHPlugin {
  const cfg = validate(config);

  const createAdapter =
    cfg.type === "oauth2_authcode"
      ? () => createOAuth2AuthCodeAuth(cfg)
      : () => createOAuth2Auth(cfg);

  return {
    id: "oauth2",
    requiredModules: ["simple_oauth"],
    createAuthAdapter: createAdapter,
    registerCommands(program) {
      program
        .command("login")
        .description("Authenticate via OAuth 2.0 Authorization Code + PKCE")
        .action(async () => {
          if (cfg.type !== "oauth2_authcode") {
            process.stderr.write("login command requires auth type oauth2_authcode\n");
            process.exitCode = 1;
            return;
          }
          const { runLogin } = await import("./login.js");
          const configPath =
            (program.opts().config as string | undefined) ??
            process.env.DROPSH_CONFIG ??
            "dropsh.config.js";
          try {
            await runLogin({
              stdout: (s) => process.stdout.write(`${s}\n`),
              clientId: cfg.client_id,
              tokenUrl: cfg.token_url,
              ...(cfg.scope !== undefined ? { scope: cfg.scope } : {}),
              ...(cfg.redirect_port !== undefined ? { redirectPort: cfg.redirect_port } : {}),
              configPath,
            });
          } catch (err) {
            process.stderr.write(`${String(err)}\n`);
            process.exitCode = 1;
          }
        });
    },
    async extendSchema(_entityType, _bundle, schema, _ctx) {
      return schema;
    },
  };
}
