import type { Command } from "commander";
import type { AuthAdapter, AuthProvider } from "./auth/types.js";
import type { AnyRenderer } from "./cli/render.js";
import type { HttpClient, HttpRequest } from "./http.js";
import type { DropSHOperation } from "./jsonapi/client.js";
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

export interface RequestContext extends PluginContext {
  operation: DropSHOperation;
  entityType?: string;
  bundle?: string;
}

/**
 * Import-free descriptor naming a plugin package as a string. Same shape used
 * by the top-level `plugins[]` config; a plugin returns these in `dependencies`
 * to have dropsh auto-load further plugins.
 */
export interface PluginDescriptor {
  plugin: string;
  with?: unknown;
  options?: unknown;
  export?: string;
}

export interface DropSHPlugin {
  readonly id: string;
  readonly requiredModules: string[];
  /**
   * Plugins this plugin depends on. dropsh resolves each descriptor and inserts
   * the resulting plugin into the flat plugin list *before* this plugin, so a
   * dependency's renderers / schema hooks are available when this plugin runs.
   * De-duplicated across the whole graph; cycles are rejected at config load.
   */
  dependencies?: PluginDescriptor[];
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
  alterRequest?(req: HttpRequest, ctx: RequestContext): Promise<HttpRequest>;
  registerCommands?(program: Command): void;
  renderers?: AnyRenderer[];
}

/**
 * Combine several child plugins into one flat plugin list. An aggregator's
 * factory returns `composePlugins(childA(), childB(), …)` and places the result
 * as a single `plugins[]` entry (a nested array) or a single named-descriptor
 * export; dropsh flattens it into separate plugin entries. This lets one config
 * entry pull in N plugins without hand-merging their hooks or presence-guarding
 * hook presence — each child stays a distinct entry, indistinguishable from N
 * separate entries. Nested arrays (composed composites) are flattened one level.
 */
export function composePlugins(...children: (DropSHPlugin | DropSHPlugin[])[]): DropSHPlugin[] {
  return children.flat();
}
