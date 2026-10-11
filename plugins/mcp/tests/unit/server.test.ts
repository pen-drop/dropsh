import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  type AuthAdapter,
  type CommandContext,
  createJsonApiClient,
  type HttpClient,
  HttpError,
  type HttpRequest,
} from "dropsh/plugin";
import { describe, expect, it, vi } from "vitest";
import { parseMcpOptions } from "../../src/options.js";
import { createMcpServer } from "../../src/server.js";

const UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function recordingHttp(
  handler: (req: HttpRequest) => { status: number; body: string } | HttpError,
): HttpClient & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async (req: HttpRequest) => {
    const result = handler(req);
    if (result instanceof HttpError) throw result;
    if (result.status >= 200 && result.status < 300) {
      return { status: result.status, headers: {}, body: result.body };
    }
    throw new HttpError(result.status, `HTTP ${result.status}`, result.body);
  });
  return { send };
}

function makeGetContext(http: HttpClient, plugins: CommandContext["plugins"] = []) {
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
  };
}

async function connectClient(
  options: ReturnType<typeof parseMcpOptions>,
  getContext: (auth?: AuthAdapter) => Promise<CommandContext>,
) {
  const server = createMcpServer(options, getContext, new Map());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe("createMcpServer", () => {
  const options = parseMcpOptions({
    bundles: ["node/article"],
    operations: ["list_entities", "read", "create"],
  });

  it("does not contact the backend when the server is constructed", () => {
    const http = recordingHttp(() => ({ status: 200, body: "{}" }));
    const ctx = makeGetContext(http);
    createMcpServer(options, ctx.getContext, new Map());
    expect(ctx.calls).toBe(0);
    expect(http.send).not.toHaveBeenCalled();
  });

  it("initializes and lists configured tools over the in-memory transport", async () => {
    const http = recordingHttp((req) => {
      const path = req.url.split("?")[0] ?? req.url;
      if (path === "https://example.com/jsonapi") {
        return {
          status: 200,
          body: JSON.stringify({
            links: {
              "node--article": {
                href: "https://example.com/jsonapi/node/article",
                meta: { title: "Article" },
              },
            },
          }),
        };
      }
      return { status: 200, body: JSON.stringify({ data: [] }) };
    });
    const ctx = makeGetContext(http);
    const { client } = await connectClient(options, ctx.getContext);
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).toEqual(["list_entities", "read"]);
  });

  it("returns list_entities through the SDK client without a protocol error", async () => {
    const http = recordingHttp((req) => {
      const path = req.url.split("?")[0] ?? req.url;
      if (path === "https://example.com/jsonapi") {
        return {
          status: 200,
          body: JSON.stringify({
            links: {
              "node--article": {
                href: "https://example.com/jsonapi/node/article",
                meta: { title: "Article" },
              },
            },
          }),
        };
      }
      return { status: 200, body: JSON.stringify({ data: [] }) };
    });
    const { client } = await connectClient(options, makeGetContext(http).getContext);
    const result = await client.callTool({ name: "list_entities", arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    const listed = JSON.parse(content[0]?.text ?? "") as Array<{
      entity_type: string;
      bundle: string;
    }>;
    expect(listed).toEqual([{ entity_type: "node", bundle: "article", label: expect.any(String) }]);
  });

  it("calls read and returns the JSON:API document", async () => {
    const http = recordingHttp((req) => {
      if (req.url.includes(UUID)) {
        return {
          status: 200,
          body: JSON.stringify({
            data: { type: "node--article", id: UUID, attributes: { title: "Hi" } },
          }),
        };
      }
      return { status: 200, body: JSON.stringify({ data: [] }) };
    });
    const { client } = await connectClient(options, makeGetContext(http).getContext);
    const result = await client.callTool({
      name: "read",
      arguments: { entityType: "node", bundle: "article", id: UUID },
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    const body = JSON.parse(content[0]?.text ?? "") as {
      data: { attributes: { title: string } };
    };
    expect(body.data.attributes.title).toBe("Hi");
  });

  it("rejects a disallowed call without backend I/O", async () => {
    const http = recordingHttp(() => {
      throw new Error("backend should not run");
    });
    const ctx = makeGetContext(http);
    const { client } = await connectClient(options, ctx.getContext);
    const result = await client.callTool({
      name: "read",
      arguments: { entityType: "node", bundle: "page", id: UUID },
    });
    expect(result.isError).toBe(true);
    expect(ctx.calls).toBe(0);
    expect(http.send).not.toHaveBeenCalled();
  });
});
