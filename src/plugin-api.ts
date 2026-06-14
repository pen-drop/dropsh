export type { BasicAuthConfig } from "./core/auth/basic.js";
export { basicAuthPlugin, basicAuthProvider } from "./core/auth/basic.js";
export type {
  AdapterRuntime,
  AuthAdapter,
  AuthContext,
  AuthProvider,
  AuthSession,
  AuthStatusInfo,
} from "./core/auth/types.js";
export type { Config, SiteConfig } from "./core/config.js";
export { loadConfig } from "./core/config.js";
export type { HttpClient, HttpRequest } from "./core/http.js";
export { createHttpClient } from "./core/http.js";
export type {
  JsonApiClient,
  JsonApiOptions,
  ResourceWriteBody,
} from "./core/jsonapi/client.js";
export { createJsonApiClient } from "./core/jsonapi/client.js";
export type { Collection, FilterOp } from "./core/jsonapi/collection.js";
export type {
  JsonApiResourceObject,
  Resource,
} from "./core/jsonapi/resource.js";
export type { DropSHPlugin, PluginContext, SchemaOperation } from "./core/plugin.js";
export { AuthError, ConfigError, HttpError } from "./errors.js";
