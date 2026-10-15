import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  type AuthAdapter,
  type CommandContext,
  createHttpClient,
  createJsonApiClient,
  type HttpRequest,
} from "dropsh/plugin";
import { afterEach, describe, expect, it } from "vitest";
import { jsonapiSchemaPlugin } from "../../plugins/jsonapi-schema/src/index.js";
import { parseMcpOptions } from "../../plugins/mcp/src/options.js";
import { startMcpHttpServer } from "../../plugins/mcp/src/transports.js";
import { readSession } from "../../src/core/auth/session-store.js";
import { oauth2Password, runCli, seedSession, testConfig } from "./helpers/run.js";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const MARKDOWN_20KIB = `${"# Integration markdown\n\n"}${"paragraph ".repeat(2000)}`.slice(
  0,
  20480,
);
const OPTIONS = parseMcpOptions({
  bundles: ["node/article_test"],
  operations: ["list_entities", "search", "read", "create", "update"],
});

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close) await close();
  }
});

function asRecord(result: unknown): { isError?: boolean; content?: unknown } {
  return result as { isError?: boolean; content?: unknown };
}

function jsonText(result: unknown): string {
  const content = asRecord(result).content as Array<{ type: string; text: string }> | undefined;
  const text = content?.[0]?.text;
  if (typeof text !== "string") throw new Error("MCP result has no text content");
  return text;
}

function extractBody(result: unknown): string {
  if (asRecord(result).isError) throw new Error(`tool error: ${jsonText(result)}`);
  const doc = JSON.parse(jsonText(result)) as {
    data?: { attributes?: { body?: { value?: string } } };
  };
  return doc.data?.attributes?.body?.value ?? "";
}

function errorPayload(result: unknown): {
  code: string;
  message: string;
  backendStatus?: number;
} {
  expect(asRecord(result).isError).toBe(true);
  return JSON.parse(jsonText(result)) as {
    code: string;
    message: string;
    backendStatus?: number;
  };
}

async function bearerToken(site: "jsonapischema"): Promise<string> {
  const cfg = testConfig(site);
  const home = await seedSession(cfg.url, oauth2Password(site));
  const session = await readSession(cfg.url, `${home}/.config/dropsh`);
  const token = session?.session.access_token;
  if (typeof token !== "string") throw new Error("password grant did not store an access_token");
  return token;
}

async function startLiveMcp(site: "jsonapischema", options = OPTIONS): Promise<URL> {
  const cfg = testConfig(site);
  const plugins = [jsonapiSchemaPlugin()];
  const started = await startMcpHttpServer({
    options,
    getContext: async (auth?: AuthAdapter): Promise<CommandContext> => {
      const adapter = auth ?? { apply: async (req: HttpRequest) => req };
      const http = createHttpClient({
        timeoutMs: 30_000,
        ...(auth !== undefined ? { maxRetries: 0 } : {}),
      });
      const ctx: CommandContext = {
        client: createJsonApiClient({
          baseUrl: cfg.url,
          prefix: "/jsonapi",
          http,
          auth: adapter,
          alterRequest: async (req) => req,
        }),
        http,
        auth: adapter,
        baseUrl: cfg.url,
        jsonapiPrefix: "/jsonapi",
        cwd: process.cwd(),
        plugins,
      };
      return ctx;
    },
  });
  closers.push(started.close);
  return new URL(`http://127.0.0.1:${started.port}/mcp`);
}

async function connect(url: URL, authorization?: string): Promise<Client> {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.Authorization = authorization;
  const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers } });
  const client = new Client({ name: "mcp-integration", version: "0.0.0" });
  await client.connect(transport as unknown as Transport);
  return client;
}

describe("integration: MCP against jsonapischema", () => {
  it("creates, reads, searches and updates a uniquely named article_test with 20 KiB Markdown", async () => {
    const title = `it-mcp-${crypto.randomUUID()}`;
    const token = await bearerToken("jsonapischema");
    const url = await startLiveMcp("jsonapischema");
    const client = await connect(url, `Bearer ${token}`);
    let id: string | undefined;
    try {
      const created = await client.callTool({
        name: "create",
        arguments: {
          entityType: "node",
          bundle: "article_test",
          payload: {
            data: {
              type: "node--article_test",
              attributes: {
                title,
                body: { value: MARKDOWN_20KIB, format: "plain_text" },
              },
            },
          },
        },
      });
      expect(created.isError).not.toBe(true);
      const createdDoc = JSON.parse(jsonText(created)) as { data: { id: string } };
      id = createdDoc.data.id;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);

      const readBack = await client.callTool({
        name: "read",
        arguments: { entityType: "node", bundle: "article_test", id },
      });
      expect(readBack.isError).not.toBe(true);
      expect(extractBody(readBack)).toBe(MARKDOWN_20KIB);

      const found = await client.callTool({
        name: "search",
        arguments: {
          entityType: "node",
          bundle: "article_test",
          filters: [`title:${title}`],
          limit: 10,
        },
      });
      expect(found.isError).not.toBe(true);
      const searchDoc = JSON.parse(jsonText(found)) as { data: Array<{ id: string }> };
      expect(searchDoc.data.map((row) => row.id)).toContain(id);

      const updatedTitle = `${title}-updated`;
      const updated = await client.callTool({
        name: "update",
        arguments: {
          entityType: "node",
          bundle: "article_test",
          id,
          payload: {
            data: {
              type: "node--article_test",
              id,
              attributes: { title: updatedTitle },
            },
          },
        },
      });
      expect(updated.isError).not.toBe(true);
      const after = await client.callTool({
        name: "read",
        arguments: { entityType: "node", bundle: "article_test", id },
      });
      const afterDoc = JSON.parse(jsonText(after)) as {
        data: { attributes: { title: string } };
      };
      expect(afterDoc.data.attributes.title).toBe(updatedTitle);
      expect(extractBody(after)).toBe(MARKDOWN_20KIB);
    } finally {
      await client.close();
      if (id) {
        const deletion = await runCli({
          site: "jsonapischema",
          args: ["delete", `node/article_test/${id}`],
        });
        expect(deletion.code).toBe(0);
      }
    }
  }, 60_000);

  it("preserves backend 401 and 403 on MCP tool errors", async () => {
    const title = `it-mcp-authz-${crypto.randomUUID()}`;
    const token = await bearerToken("jsonapischema");
    const url = await startLiveMcp(
      "jsonapischema",
      parseMcpOptions({
        bundles: ["node/article_test", "user/user"],
        operations: ["list_entities", "search", "read", "create", "update"],
      }),
    );
    const authed = await connect(url, `Bearer ${token}`);
    let id: string | undefined;
    try {
      const created = await authed.callTool({
        name: "create",
        arguments: {
          entityType: "node",
          bundle: "article_test",
          payload: {
            data: {
              type: "node--article_test",
              attributes: { title },
            },
          },
        },
      });
      expect(created.isError).not.toBe(true);
      id = (JSON.parse(jsonText(created)) as { data: { id: string } }).data.id;

      const anonymous = await connect(url);
      try {
        const anonCreate = await anonymous.callTool({
          name: "create",
          arguments: {
            entityType: "node",
            bundle: "article_test",
            payload: {
              data: {
                type: "node--article_test",
                attributes: { title: `${title}-anon` },
              },
            },
          },
        });
        const unauthenticated = errorPayload(anonCreate);
        expect(unauthenticated.code).toBe("E_HTTP");
        expect(unauthenticated.backendStatus).toBe(401);
      } finally {
        await anonymous.close();
      }

      const unauthorized = await connect(url, "Bearer definitely-not-a-token");
      try {
        const badRead = await unauthorized.callTool({
          name: "read",
          arguments: { entityType: "node", bundle: "article_test", id },
        });
        const body = errorPayload(badRead);
        expect(body.code).toBe("E_HTTP");
        expect(body.backendStatus).toBe(401);
      } finally {
        await unauthorized.close();
      }

      const forbidden = errorPayload(
        await authed.callTool({
          name: "create",
          arguments: {
            entityType: "user",
            bundle: "user",
            payload: {
              data: {
                type: "user--user",
                attributes: { name: `nope-${crypto.randomUUID()}`, mail: "nope@example.com" },
              },
            },
          },
        }),
      );
      expect(forbidden.code).toBe("E_HTTP");
      expect(forbidden.backendStatus).toBe(403);
    } finally {
      await authed.close();
      if (id) {
        await runCli({ site: "jsonapischema", args: ["delete", `node/article_test/${id}`] });
      }
    }
  }, 60_000);

  it("rejects a disallowed bundle and a disabled operation before Drupal I/O", async () => {
    const token = await bearerToken("jsonapischema");
    const url = await startLiveMcp("jsonapischema");
    const client = await connect(url, `Bearer ${token}`);
    try {
      const bundle = errorPayload(
        await client.callTool({
          name: "read",
          arguments: {
            entityType: "node",
            bundle: "page",
            id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          },
        }),
      );
      expect(bundle.code).toBe("E_POLICY");
      expect(bundle.message).toMatch(/not allowlisted/);

      const operation = errorPayload(await client.callTool({ name: "describe", arguments: {} }));
      expect(operation.code).toBe("E_POLICY");
    } finally {
      await client.close();
    }
  }, 60_000);
});
