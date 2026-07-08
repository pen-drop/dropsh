import type { Command } from "commander";
import type { AuthAdapter, AuthProvider } from "./auth/types.js";
import type { HttpClient } from "./http.js";
import type { Operation } from "./schema/to-jsonschema.js";

export interface PluginContext {
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  /**
   * JSON:API path prefix (e.g. "/jsonapi"). Present when the schema pipeline
   * builds the context; plugins that target routes under the JSON:API prefix
   * should fall back to "/jsonapi" when it is absent.
   */
  jsonapiPrefix?: string;
  /**
   * Emit a user-visible warning (goes to stderr). Plugins use this to surface
   * a broken/unreachable authoritative-schema endpoint instead of silently
   * falling back to the heuristic schema.
   */
  warn?: (message: string) => void;
}

export type SchemaOperation = Operation;

export interface DropSHPlugin {
  readonly id: string;
  readonly requiredModules: string[];
  /** Provider-based auth (login/logout/status/createAdapter). */
  authProvider?: AuthProvider;
  /**
   * Optional schema extension. Plugins that contribute other capabilities
   * (auth, commands, or consumer-defined slots) can omit it.
   */
  extendSchema?(
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
