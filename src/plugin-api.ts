export type { CreateArgs, CreateDeps } from "./commands/create.js";
export { runCreate } from "./commands/create.js";
export type { ReadArgs, ReadDeps } from "./commands/read.js";
export { runRead } from "./commands/read.js";
export { applyOperationSchemaPlugins } from "./commands/schema.js";
export type { SearchArgs, SearchDeps } from "./commands/search.js";
export { runSearch } from "./commands/search.js";
export type { UpdateArgs, UpdateDeps } from "./commands/update.js";
export { runUpdate } from "./commands/update.js";
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
export type {
  AnyRenderer,
  InteractiveRenderer,
  RenderContext,
  Renderer,
  RenderServices,
} from "./core/cli/render.js";
export { indexIncluded, isInteractive } from "./core/cli/render.js";
export type { CommandContext, PluginCommandServices } from "./core/command-context.js";
export type { Config, SiteConfig } from "./core/config.js";
export { loadConfig } from "./core/config.js";
export type {
  ConfigSource,
  ConfigSourceKind,
  ConnectionEntry,
  ResolveConfigSourceInput,
  ResolveConnectionsDirInput,
} from "./core/connections.js";
export {
  CWD_CONFIG_FILE,
  listConnectionIds,
  listConnections,
  resolveConfigSource,
  resolveConnectionsDir,
} from "./core/connections.js";
export type { HttpClient, HttpRequest } from "./core/http.js";
export { createHttpClient } from "./core/http.js";
export type {
  DropSHOperation,
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
export type { JsonApiDocument, JsonApiResource } from "./core/jsonapi/types.js";
export type { BuildPayloadInput } from "./core/params/from-parameters.js";
export { buildPayloadFromParameters } from "./core/params/from-parameters.js";
export type { RawParameter } from "./core/params/parse-args.js";
export type { FieldDescriptor, SchemaFieldIndex } from "./core/params/schema-fields.js";
export { indexSchemaFields, propertiesOf } from "./core/params/schema-fields.js";
export type {
  DropSHPlugin,
  PluginContext,
  PluginDescriptor,
  RequestContext,
  SchemaOperation,
} from "./core/plugin.js";
export { composePlugins } from "./core/plugin.js";
export { fetchCatalog } from "./core/schema/catalog.js";
export { fetchJsonSchema } from "./core/schema/jsonschema-source.js";
export type { Operation } from "./core/schema/to-jsonschema.js";
export { toOperationVariant } from "./core/schema/to-jsonschema.js";
export { validatePayload } from "./core/schema/validate.js";
export {
  AuthError,
  CliError,
  ConfigError,
  exitCodeFor,
  HttpError,
  PluginError,
  ValidationError,
} from "./errors.js";
