import type { Command } from "commander";
import type { AuthAdapter } from "./auth/types.js";
import type { HttpClient } from "./http.js";
import type { Operation } from "./schema/to-jsonschema.js";

export interface PluginContext {
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
}

export type SchemaOperation = Operation;

export interface DropSHPlugin {
  readonly id: string;
  readonly requiredModules: string[];
  createAuthAdapter?(): AuthAdapter;
  extendSchema(
    entityType: string,
    bundle: string,
    baseSchema: unknown,
    ctx: PluginContext,
  ): Promise<unknown>;
  extendOperationSchema?(
    entityType: string,
    bundle: string,
    operation: SchemaOperation,
    operationSchema: unknown,
    ctx: PluginContext,
  ): Promise<unknown>;
  registerCommands?(program: Command): void;
}
