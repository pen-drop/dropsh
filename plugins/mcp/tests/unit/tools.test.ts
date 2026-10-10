import {
  type AuthAdapter,
  type CommandContext,
  createJsonApiClient,
  type DropSHPlugin,
  type HttpClient,
  HttpError,
  type HttpRequest,
  ValidationError,
  validatePayload,
} from "dropsh/plugin";
import { describe, expect, it, vi } from "vitest";
import { parseMcpOptions } from "../../src/options.js";
import { buildInputSchema, createToolHandlers } from "../../src/tools.js";

const ARTICLE = "node/article";
const PAGE = "node/page";
const UUID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const unit = "αβγ";
const MARKDOWN_20KIB =
  unit.repeat(Math.floor(20480 / Buffer.byteLength(unit))) +
  "x".repeat(20480 - Math.floor(20480 / Buffer.byteLength(unit)) * Buffer.byteLength(unit));

function articleSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["data"],
    properties: {
      data: {
        type: "object",
        required: ["type"],
        properties: {
          type: { $ref: "#/definitions/type" },
          attributes: { $ref: "#/definitions/attributes" },
          relationships: { $ref: "#/definitions/relationships" },
        },
      },
    },
    definitions: {
      type: { const: "node--article" },
      attributes: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", maxLength: 255 },
          created: { type: "string", format: "date-time" },
          body: {
            type: "object",
            properties: { value: { type: "string" }, format: { type: "string" } },
          },
          nested: { $ref: "#/definitions/node" },
        },
      },
      relationships: {
        type: "object",
        properties: {
          field_tags: {
            type: "object",
            properties: {
              data: {
                type: "array",
                items: {
                  type: "object",
                  properties: { type: { type: "string" }, id: { type: "string", format: "uuid" } },
                },
              },
            },
          },
        },
      },
      node: {
        type: "object",
        properties: {
          name: { type: "string" },
          child: { $ref: "#/definitions/node" },
        },
      },
    },
  };
}

function pageSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["data"],
    properties: {
      data: {
        type: "object",
        required: ["type"],
        properties: {
          type: { $ref: "#/definitions/type" },
          attributes: { $ref: "#/definitions/attributes" },
        },
      },
    },
    definitions: {
      type: { const: "node--page" },
      attributes: {
        type: "object",
        required: ["title"],
        properties: { title: { type: "string" } },
      },
    },
  };
}

function schemaPlugin(schemas: Record<string, unknown>): DropSHPlugin {
  return {
    id: "jsonapi-schema",
    requiredModules: [],
    async extendSchema(entityType, bundle, base) {
      return schemas[`${entityType}/${bundle}`] ?? base;
    },
  };
}

function catalogBody(keys: string[]): string {
  const links: Record<string, { href: string; meta: { title: string } }> = {
    self: { href: "https://example.com/jsonapi", meta: { title: "self" } },
  };
  for (const key of keys) {
    links[key] = {
      href: `https://example.com/jsonapi/${key.replace("--", "/")}`,
      meta: { title: key },
    };
  }
  return JSON.stringify({ links });
}

function collectionBody(
  type: string,
  records: Array<{ id?: string; attributes?: Record<string, unknown> }> = [],
): string {
  return JSON.stringify({
    data: records.map((r, i) => ({
      type,
      id: r.id ?? `id-${i}`,
      attributes: r.attributes ?? { title: "t" },
    })),
  });
}

type TestResponse = { status: number; headers?: Record<string, string>; body: string };

function recordingHttp(
  handler: (req: HttpRequest) => TestResponse | HttpError,
): HttpClient & { send: ReturnType<typeof vi.fn>; requests: HttpRequest[] } {
  const requests: HttpRequest[] = [];
  const send = vi.fn(async (req: HttpRequest) => {
    requests.push(req);
    const result = handler(req);
    if (result instanceof HttpError) throw result;
    if (result.status >= 200 && result.status < 300) {
      return { headers: {}, ...result };
    }
    throw new HttpError(result.status, `HTTP ${result.status}`, result.body);
  });
  return { send, requests };
}

function makeContext(
  http: HttpClient,
  plugins: DropSHPlugin[] = [],
): { getContext: (auth?: AuthAdapter) => Promise<CommandContext>; calls: number } {
  const state = { calls: 0 };
  const getContext = async (auth?: AuthAdapter) => {
    state.calls += 1;
    const adapter = auth ?? { apply: async (req: HttpRequest) => req };
    return {
      client: createJsonApiClient({
        baseUrl: "https://example.com",
        prefix: "/jsonapi",
        http,
        auth: adapter,
      }),
      http,
      auth: adapter,
      baseUrl: "https://example.com",
      jsonapiPrefix: "/jsonapi",
      cwd: ".",
      plugins,
    };
  };
  return {
    getContext,
    get calls() {
      return state.calls;
    },
  } as {
    getContext: (auth?: AuthAdapter) => Promise<CommandContext>;
    calls: number;
  };
}

function errorBody(result: {
  isError?: boolean;
  content?: Array<{ type: string; text: string }>;
}): {
  code: string;
  message: string;
  backendStatus?: number;
} {
  expect(result.isError).toBe(true);
  const text = result.content?.[0]?.text;
  expect(typeof text).toBe("string");
  return JSON.parse(text as string) as { code: string; message: string; backendStatus?: number };
}

function defaultHandler(req: HttpRequest): TestResponse {
  const path = req.url.split("?")[0] ?? req.url;
  if (req.method === "GET" && path === "https://example.com/jsonapi") {
    return { status: 200, headers: {}, body: catalogBody(["node--article", "node--page"]) };
  }
  if (req.method === "GET" && path.includes("/node/article")) {
    return {
      status: 200,
      headers: {},
      body: collectionBody("node--article", [{ id: UUID_A, attributes: { title: "Hello" } }]),
    };
  }
  if (req.method === "GET" && path.includes("/node/page")) {
    return {
      status: 200,
      headers: {},
      body: collectionBody("node--page", [{ attributes: { title: "Page" } }]),
    };
  }
  if (req.method === "POST" && path.includes("/node/article")) {
    const incoming = JSON.parse(String(req.body ?? "{}")) as {
      data?: { attributes?: Record<string, unknown> };
    };
    return {
      status: 201,
      headers: {},
      body: JSON.stringify({
        data: {
          type: "node--article",
          id: UUID_A,
          attributes: {
            title: incoming.data?.attributes?.title,
            identifier: "DROPSH-21",
            body: incoming.data?.attributes?.body,
          },
        },
      }),
    };
  }
  if (req.method === "PATCH" && path.includes("/node/article")) {
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({
        data: { type: "node--article", id: UUID_A, attributes: { title: "Updated" } },
      }),
    };
  }
  return { status: 404, headers: {}, body: "{}" };
}

describe("buildInputSchema", () => {
  it("embeds required fields, relationships, formats and rebased recursive refs", () => {
    const source = articleSchema();
    const schema = buildInputSchema("create", [
      { entityType: "node", bundle: "article", schema: source },
    ]);
    expect(source.definitions).toEqual(articleSchema().definitions);
    expect(() =>
      validatePayload(
        schema,
        {
          entityType: "node",
          bundle: "article",
          payload: { data: { type: "node--article", attributes: {} } },
        },
        "mcp/create",
      ),
    ).toThrow(ValidationError);

    validatePayload(
      schema,
      {
        entityType: "node",
        bundle: "article",
        payload: {
          data: {
            type: "node--article",
            attributes: {
              title: "Hello",
              created: "2026-01-01T00:00:00Z",
              nested: { name: "root", child: { name: "leaf" } },
            },
            relationships: {
              field_tags: {
                data: [{ type: "taxonomy_term--tags", id: UUID_A }],
              },
            },
          },
        },
      },
      "mcp/create",
    );
  });

  it("keeps colliding definition names local to each oneOf branch", () => {
    const schema = buildInputSchema("create", [
      { entityType: "node", bundle: "article", schema: articleSchema() },
      { entityType: "node", bundle: "page", schema: pageSchema() },
    ]);
    validatePayload(
      schema,
      {
        entityType: "node",
        bundle: "page",
        payload: { data: { type: "node--page", attributes: { title: "P" } } },
      },
      "mcp/create",
    );
    expect(() =>
      validatePayload(
        schema,
        {
          entityType: "node",
          bundle: "article",
          payload: { data: { type: "node--page", attributes: { title: "P" } } },
        },
        "mcp/create",
      ),
    ).toThrow(ValidationError);
  });

  it("rejects unsupported external refs when embedding a write schema", () => {
    expect(() =>
      buildInputSchema("create", [
        {
          entityType: "node",
          bundle: "article",
          schema: { $ref: "https://jsonapi.org/schema#/definitions/resource" },
        },
      ]),
    ).toThrow(/unsupported/);
  });
});

describe("createToolHandlers policy", () => {
  const options = parseMcpOptions({
    bundles: [ARTICLE],
    operations: ["list_entities", "search", "read", "create", "update", "describe"],
  });

  it("does not advertise entity tools when allowlists are empty", async () => {
    const http = recordingHttp(defaultHandler);
    const { getContext } = makeContext(http);
    const handlers = createToolHandlers(
      parseMcpOptions({ bundles: [], operations: [] }),
      getContext,
    );
    expect(await handlers.list()).toEqual([]);
  });

  it("rejects a disallowed bundle before getContext or HTTP", async () => {
    const http = recordingHttp(defaultHandler);
    const ctx = makeContext(http);
    const handlers = createToolHandlers(options, ctx.getContext);
    const result = await handlers.call("create", {
      entityType: "node",
      bundle: "page",
      payload: { data: { type: "node--page", attributes: { title: "x" } } },
    });
    const body = errorBody(result);
    expect(body.code).toBe("E_POLICY");
    expect(ctx.calls).toBe(0);
    expect(http.send).not.toHaveBeenCalled();
  });

  it("rejects an unknown tool and a malformed selector without I/O", async () => {
    const http = recordingHttp(defaultHandler);
    const ctx = makeContext(http);
    const handlers = createToolHandlers(options, ctx.getContext);
    expect(errorBody(await handlers.call("delete", {})).code).toBe("E_POLICY");
    expect(
      errorBody(await handlers.call("read", { entityType: "NODE", bundle: "article", id: UUID_A }))
        .code,
    ).toBe("E_POLICY");
    expect(ctx.calls).toBe(0);
    expect(http.send).not.toHaveBeenCalled();
  });

  it("rejects update data.id and data.type mismatches before getContext", async () => {
    const http = recordingHttp(defaultHandler);
    const ctx = makeContext(http);
    const handlers = createToolHandlers(options, ctx.getContext);
    expect(
      errorBody(
        await handlers.call("update", {
          entityType: "node",
          bundle: "article",
          id: UUID_A,
          payload: { data: { type: "node--article", id: UUID_B, attributes: { title: "x" } } },
        }),
      ).code,
    ).toBe("E_VALIDATION");
    expect(
      errorBody(
        await handlers.call("update", {
          entityType: "node",
          bundle: "article",
          id: UUID_A,
          payload: { data: { type: "node--page", id: UUID_A, attributes: { title: "x" } } },
        }),
      ).code,
    ).toBe("E_VALIDATION");
    expect(ctx.calls).toBe(0);
    expect(http.send).not.toHaveBeenCalled();
  });
});

describe("createToolHandlers dispatch", () => {
  const options = parseMcpOptions({
    bundles: [ARTICLE, PAGE],
    operations: ["list_entities", "search", "read", "create", "update", "describe"],
  });
  const plugins = [schemaPlugin({ [ARTICLE]: articleSchema(), [PAGE]: pageSchema() })];

  it("creates an article, including 20 KiB Unicode Markdown, and returns identifier", async () => {
    const http = recordingHttp(defaultHandler);
    const ctx = makeContext(http, plugins);
    const handlers = createToolHandlers(options, ctx.getContext);
    expect(Buffer.byteLength(MARKDOWN_20KIB)).toBe(20480);
    const result = await handlers.call("create", {
      entityType: "node",
      bundle: "article",
      payload: {
        data: {
          type: "node--article",
          attributes: { title: "Hello", body: { value: MARKDOWN_20KIB, format: "basic_html" } },
        },
      },
    });
    expect(result.isError).toBeFalsy();
    if (result.isError) throw new Error("expected create to succeed");
    const text = JSON.parse(result.content[0].text) as {
      data: { attributes: { identifier: string; body: { value: string } } };
    };
    expect(text.data.attributes.identifier).toBe("DROPSH-21");
    expect(text.data.attributes.body.value).toBe(MARKDOWN_20KIB);
    expect(result.structuredContent).toEqual(text);
    const posted = http.requests.find((r) => r.method === "POST");
    expect(String(posted?.body)).toContain(MARKDOWN_20KIB);
  });

  it("fails create when only a heuristic schema is available", async () => {
    const http = recordingHttp(defaultHandler);
    const ctx = makeContext(http, []);
    const handlers = createToolHandlers(
      parseMcpOptions({ bundles: [ARTICLE], operations: ["create"] }),
      ctx.getContext,
    );
    const body = errorBody(
      await handlers.call("create", {
        entityType: "node",
        bundle: "article",
        payload: { data: { type: "node--article", attributes: { title: "Hello" } } },
      }),
    );
    expect(body.code).toBe("E_VALIDATION");
    expect(body.message).toMatch(/authoritative schema plugin is required for writes/);
  });

  it("lists only allowlisted readable collections, keeps empty ones, omits 403, and never probes others", async () => {
    const http = recordingHttp((req) => {
      const path = req.url.split("?")[0] ?? req.url;
      if (req.method === "GET" && path === "https://example.com/jsonapi") {
        return {
          status: 200,
          headers: {},
          body: catalogBody(["node--article", "node--page", "node--secret"]),
        };
      }
      if (path.includes("/node/article")) {
        return { status: 200, headers: {}, body: collectionBody("node--article", []) };
      }
      if (path.includes("/node/page")) {
        return { status: 403, headers: {}, body: "{}" };
      }
      throw new Error(`unexpected probe ${req.url}`);
    });
    const ctx = makeContext(http);
    const handlers = createToolHandlers(
      parseMcpOptions({ bundles: [ARTICLE, PAGE], operations: ["list_entities"] }),
      ctx.getContext,
    );
    const result = await handlers.call("list_entities", {});
    expect(result.isError).toBeFalsy();
    const listed = JSON.parse((result.content?.[0] as { text: string }).text) as Array<{
      entity_type: string;
      bundle: string;
    }>;
    expect(listed).toEqual([{ entity_type: "node", bundle: "article", label: expect.any(String) }]);
    expect(http.requests.some((r) => r.url.includes("secret"))).toBe(false);
  });

  it("propagates list_entities 401 and infrastructure failures", async () => {
    const unauthorized = recordingHttp(() => new HttpError(401, "HTTP 401", { message: "nope" }));
    const ctx401 = makeContext(unauthorized);
    const handlers401 = createToolHandlers(
      parseMcpOptions({ bundles: [ARTICLE], operations: ["list_entities"] }),
      ctx401.getContext,
    );
    const body401 = errorBody(await handlers401.call("list_entities", {}));
    expect(body401.code).toBe("E_HTTP");
    expect(body401.backendStatus).toBe(401);

    const down = recordingHttp(() => new HttpError(0, "Network failure", {}));
    const ctxDown = makeContext(down);
    const handlersDown = createToolHandlers(
      parseMcpOptions({ bundles: [ARTICLE], operations: ["list_entities"] }),
      ctxDown.getContext,
    );
    const bodyDown = errorBody(await handlersDown.call("list_entities", {}));
    expect(bodyDown.code).toBe("E_HTTP");
    expect(bodyDown.backendStatus).toBe(0);
  });

  it("maps backend 401 and 403 from read onto MCP errors", async () => {
    const http = recordingHttp((req) => {
      if (req.url.includes(UUID_A)) return new HttpError(401, "HTTP 401", {});
      return new HttpError(403, "HTTP 403", {});
    });
    const ctx = makeContext(http);
    const handlers = createToolHandlers(
      parseMcpOptions({ bundles: [ARTICLE], operations: ["read"] }),
      ctx.getContext,
    );
    expect(
      errorBody(await handlers.call("read", { entityType: "node", bundle: "article", id: UUID_A }))
        .backendStatus,
    ).toBe(401);
    expect(
      errorBody(await handlers.call("read", { entityType: "node", bundle: "article", id: UUID_B }))
        .backendStatus,
    ).toBe(403);
  });

  it("describe returns the operation schema plus source metadata", async () => {
    const http = recordingHttp(defaultHandler);
    const ctx = makeContext(http, plugins);
    const handlers = createToolHandlers(
      parseMcpOptions({ bundles: [ARTICLE], operations: ["describe"] }),
      ctx.getContext,
    );
    const result = await handlers.call("describe", {
      entityType: "node",
      bundle: "article",
      operation: "create",
    });
    expect(result.isError).toBeFalsy();
    const described = JSON.parse((result.content?.[0] as { text: string }).text) as {
      source: string;
      target: { entity_type: string; bundle: string };
      schema: { properties: { data: unknown } };
    };
    expect(described.source).toBe("jsonapi-schema");
    expect(described.target).toEqual({ entity_type: "node", bundle: "article" });
    expect(described.schema.properties.data).toBeTruthy();
  });
});
