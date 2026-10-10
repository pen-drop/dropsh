import type { AuthAdapter } from "./auth/types.js";
import type { HttpClient } from "./http.js";
import type { JsonApiClient } from "./jsonapi/client.js";
import type { DropSHPlugin } from "./plugin.js";

export interface CommandContext {
  client: JsonApiClient;
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  jsonapiPrefix: string;
  cwd: string;
  plugins: DropSHPlugin[];
}

export interface PluginCommandServices {
  getContext(auth?: AuthAdapter): Promise<CommandContext>;
  stderr(message: string): void;
}
