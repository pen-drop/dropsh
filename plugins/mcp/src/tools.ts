import {
  type AuthAdapter,
  applyOperationSchemaPlugins,
  type CommandContext,
  fetchCatalog,
  fetchJsonSchema,
  HttpError,
  runCreate,
  runRead,
  runSearch,
  runUpdate,
  toOperationVariant,
  ValidationError,
  validatePayload,
} from "dropsh/plugin";
import { errorFromUnknown, type McpErrorResult, policyError } from "./errors.js";
import {
  type BundleSelector,
  isToolEnabled,
  type McpOptions,
  parseBundleSelector,
  TOOL_NAMES,
  type ToolName,
} from "./options.js";
import { rebaseLocalRefs } from "./refs.js";

export type { McpOptions, ToolName } from "./options.js";
export { parseMcpOptions } from "./options.js";

export interface SchemaEntry {
  entityType: string;
  bundle: string;
  schema: unknown;
}

export interface McpTool {
  name: ToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolSuccess {
  isError?: false;
  content: [{ type: "text"; text: string }];
  structuredContent?: unknown;
}

export type McpCallResult = McpToolSuccess | McpErrorResult;

const DESCRIPTIONS: Record<ToolName, string> = {
  list_entities: "List allowlisted entity bundles visible to the caller",
  search: "Search entities of one allowlisted type and bundle",
  read: "Read one entity by UUID",
  create: "Create an entity from a JSON:API document",
  update: "Update an entity from a JSON:API document",
  describe: "Return the write-operation JSON Schema for a bundle",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeBranch(
  operation: "create" | "update",
  entry: SchemaEntry,
  index: number,
): Record<string, unknown> {
  const variant = toOperationVariant(entry.schema, operation);
  const payload = rebaseLocalRefs(variant, `#/oneOf/${index}/properties/payload`);
  const properties: Record<string, unknown> = {
    entityType: { const: entry.entityType },
    bundle: { const: entry.bundle },
    payload,
  };
  const required = ["entityType", "bundle", "payload"];
  if (operation === "update") {
    properties.id = { type: "string" };
    required.splice(2, 0, "id");
  }
  return { type: "object", additionalProperties: false, required, properties };
}

function selectorBranch(
  entry: SchemaEntry,
  extra: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "bundle", ...required],
    properties: {
      entityType: { const: entry.entityType },
      bundle: { const: entry.bundle },
      ...extra,
    },
  };
}

export function buildInputSchema(name: ToolName, entries: SchemaEntry[]): Record<string, unknown> {
  if (name === "list_entities") {
    return { type: "object", properties: {}, additionalProperties: false };
  }
  if (name === "create") {
    return { type: "object", oneOf: entries.map((entry, i) => writeBranch("create", entry, i)) };
  }
  if (name === "update") {
    return { type: "object", oneOf: entries.map((entry, i) => writeBranch("update", entry, i)) };
  }
  if (name === "search") {
    return {
      type: "object",
      oneOf: entries.map((entry) =>
        selectorBranch(
          entry,
          {
            filters: { type: "array", items: { type: "string" }, default: [] },
            sort: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
          },
          [],
        ),
      ),
    };
  }
  if (name === "read") {
    return {
      type: "object",
      oneOf: entries.map((entry) => selectorBranch(entry, { id: { type: "string" } }, ["id"])),
    };
  }
  return {
    type: "object",
    oneOf: entries.map((entry) =>
      selectorBranch(
        entry,
        { operation: { type: "string", enum: ["create", "update"], default: "create" } },
        [],
      ),
    ),
  };
}

function success(value: unknown): McpToolSuccess {
  const result: McpToolSuccess = {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
  if (value !== null && typeof value === "object") {
    result.structuredContent = value;
  }
  return result;
}

function resourceType(entityType: string, bundle: string): string {
  return `${entityType}--${bundle}`;
}

function assertPayloadTarget(
  entityType: string,
  bundle: string,
  payload: unknown,
  id?: string,
): void {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new ValidationError("payload.data is required");
  }
  const expected = resourceType(entityType, bundle);
  if (payload.data.type !== expected) {
    throw new ValidationError(`payload data.type must be '${expected}'`);
  }
  if (id !== undefined && payload.data.id !== id) {
    throw new ValidationError("payload data.id must match id");
  }
}

function parseSelector(
  options: McpOptions,
  args: Record<string, unknown>,
): BundleSelector | McpErrorResult {
  if (typeof args.entityType !== "string" || typeof args.bundle !== "string") {
    return policyError("entityType and bundle are required");
  }
  const raw = `${args.entityType}/${args.bundle}`;
  try {
    parseBundleSelector(raw);
  } catch {
    return policyError(`invalid bundle selector '${raw}'`);
  }
  if (!options.bundles.includes(raw)) {
    return policyError(`bundle '${raw}' is not allowlisted`);
  }
  return parseBundleSelector(raw);
}

function isErrorResult(value: BundleSelector | McpErrorResult): value is McpErrorResult {
  return "isError" in value;
}

async function loadWriteSchema(
  ctx: CommandContext,
  selector: BundleSelector,
  operation: "create" | "update",
): Promise<{ schema: unknown; source: string; target: { entity_type: string; bundle: string } }> {
  const base = await fetchJsonSchema({
    http: ctx.http,
    auth: ctx.auth,
    baseUrl: ctx.baseUrl,
    jsonapiPrefix: ctx.jsonapiPrefix,
    entity: selector.entityType,
    bundle: selector.bundle,
    warn: () => {},
    plugins: ctx.plugins,
  });
  if (base.source === "heuristic" || base.source === "heuristic-empty") {
    throw new ValidationError("An authoritative schema plugin is required for writes");
  }
  const variant = toOperationVariant(base.schema, operation);
  const extended = await applyOperationSchemaPlugins(
    variant,
    { entity: selector.entityType, bundle: selector.bundle, operation },
    { http: ctx.http, auth: ctx.auth, baseUrl: ctx.baseUrl, plugins: ctx.plugins },
  );
  return { schema: extended.schema, source: base.source, target: base.target };
}

async function probeReadable(
  ctx: CommandContext,
  entityType: string,
  bundle: string,
): Promise<"ok" | "omit"> {
  const base = ctx.baseUrl.replace(/\/+$/, "");
  const prefix = ctx.jsonapiPrefix.startsWith("/") ? ctx.jsonapiPrefix : `/${ctx.jsonapiPrefix}`;
  const url = `${base}${prefix}/${entityType}/${bundle}?page%5Blimit%5D=1`;
  const req = await ctx.auth.apply({
    method: "GET",
    url,
    headers: { Accept: "application/vnd.api+json" },
  });
  try {
    const res = await ctx.http.send(req);
    if (res.status === 403 || res.status === 404) return "omit";
    if (res.status < 200 || res.status >= 300) {
      throw new HttpError(res.status, `cannot reach ${url}: HTTP ${res.status}`, res.body);
    }
    return "ok";
  } catch (err) {
    if (err instanceof HttpError && (err.status === 403 || err.status === 404)) return "omit";
    throw err;
  }
}

async function callListEntities(options: McpOptions, ctx: CommandContext): Promise<McpCallResult> {
  const catalog = await fetchCatalog({
    http: ctx.http,
    auth: ctx.auth,
    baseUrl: ctx.baseUrl,
    jsonapiPrefix: ctx.jsonapiPrefix,
  });
  const allowed = new Set(options.bundles);
  const visible = [];
  for (const entry of catalog) {
    const selector = `${entry.entity_type}/${entry.bundle}`;
    if (!allowed.has(selector)) continue;
    const probe = await probeReadable(ctx, entry.entity_type, entry.bundle);
    if (probe === "ok") visible.push(entry);
  }
  return success(visible);
}

async function emitCapture(
  run: (emit: (value: unknown) => void) => Promise<void>,
): Promise<McpCallResult> {
  let captured: unknown;
  await run((value) => {
    captured = value;
  });
  return success(captured);
}

async function dispatch(
  options: McpOptions,
  getContext: (auth?: AuthAdapter) => Promise<CommandContext>,
  name: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  if (!TOOL_NAMES.includes(name as ToolName) || !isToolEnabled(options, name as ToolName)) {
    return policyError(`unknown or disabled tool '${name}'`);
  }
  const tool = name as ToolName;

  if (tool === "list_entities") {
    const ctx = await getContext();
    return callListEntities(options, ctx);
  }

  const selector = parseSelector(options, args);
  if (isErrorResult(selector)) return selector;

  if (tool === "create" || tool === "update") {
    if (tool === "update" && typeof args.id !== "string") {
      throw new ValidationError("id is required");
    }
    assertPayloadTarget(
      selector.entityType,
      selector.bundle,
      args.payload,
      tool === "update" ? (args.id as string) : undefined,
    );
    const ctx = await getContext();
    const loaded = await loadWriteSchema(ctx, selector, tool);
    return emitCapture(async (emit) => {
      const validate = (payload: unknown, target: string) => {
        validatePayload(loaded.schema, payload, target);
      };
      if (tool === "create") {
        await runCreate(
          { entityType: selector.entityType, bundle: selector.bundle, payload: args.payload },
          { client: ctx.client, emit, validate },
        );
      } else {
        await runUpdate(
          {
            target: `${selector.entityType}/${selector.bundle}/${args.id as string}`,
            payload: args.payload,
          },
          { client: ctx.client, emit, validate },
        );
      }
    });
  }

  const ctx = await getContext();
  if (tool === "read") {
    if (typeof args.id !== "string") throw new ValidationError("id is required");
    return emitCapture((emit) =>
      runRead(
        { target: `${selector.entityType}/${selector.bundle}/${args.id as string}` },
        { client: ctx.client, emit },
      ),
    );
  }
  if (tool === "search") {
    const filters = Array.isArray(args.filters) ? args.filters.map((item) => String(item)) : [];
    const limit = typeof args.limit === "number" ? args.limit : 25;
    return emitCapture((emit) =>
      runSearch(
        {
          entityType: selector.entityType,
          bundle: selector.bundle,
          filters,
          limit,
          ...(typeof args.sort === "string" ? { sort: args.sort } : {}),
        },
        { client: ctx.client, emit },
      ),
    );
  }

  const operation = args.operation === "update" ? "update" : "create";
  const described = await loadWriteSchema(ctx, selector, operation);
  return success({
    schema: described.schema,
    source: described.source,
    target: described.target,
  });
}

export function createToolHandlers(
  options: McpOptions,
  getContext: (auth?: AuthAdapter) => Promise<CommandContext>,
): {
  list(): Promise<McpTool[]>;
  call(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
} {
  return {
    async list() {
      const advertised = TOOL_NAMES.filter((name) => isToolEnabled(options, name));
      if (advertised.length === 0) return [];
      const ctx = await getContext();
      const catalog = await fetchCatalog({
        http: ctx.http,
        auth: ctx.auth,
        baseUrl: ctx.baseUrl,
        jsonapiPrefix: ctx.jsonapiPrefix,
      }).catch((err: unknown) => {
        if (err instanceof HttpError && (err.status === 403 || err.status === 404)) return [];
        throw err;
      });
      const allowed = new Set(options.bundles);
      const visible = catalog
        .filter((entry) => allowed.has(`${entry.entity_type}/${entry.bundle}`))
        .map((entry) => ({
          entityType: entry.entity_type,
          bundle: entry.bundle,
          schema: {},
        }));
      const writeEntries: SchemaEntry[] = [];
      for (const raw of options.bundles) {
        const selector = parseBundleSelector(raw);
        try {
          const loaded = await loadWriteSchema(ctx, selector, "create");
          writeEntries.push({
            entityType: selector.entityType,
            bundle: selector.bundle,
            schema: loaded.schema,
          });
        } catch (err) {
          if (err instanceof HttpError && (err.status === 403 || err.status === 404)) continue;
          if (err instanceof ValidationError) continue;
          throw err;
        }
      }
      return advertised.map((name) => ({
        name,
        description: DESCRIPTIONS[name],
        inputSchema: buildInputSchema(
          name,
          name === "create" || name === "update" ? writeEntries : visible,
        ),
      }));
    },
    async call(name, args) {
      try {
        return await dispatch(options, getContext, name, args);
      } catch (err) {
        return errorFromUnknown(err);
      }
    },
  };
}
