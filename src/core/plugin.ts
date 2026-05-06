import type { Command } from "commander";
import type { AuthAdapter } from "./auth/types.js";
import type { HttpClient } from "./http.js";

export interface PluginContext {
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
}

export interface DrupalCliPlugin {
  readonly id: string;
  readonly requiredModules: string[];
  createAuthAdapter?(): AuthAdapter;
  extendSchema(
    entityType: string,
    bundle: string,
    baseSchema: unknown,
    ctx: PluginContext,
  ): Promise<unknown>;
  registerCommands?(program: Command): void;
}
