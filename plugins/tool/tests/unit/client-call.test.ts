import { type AuthAdapter, AuthError, HttpError, ValidationError } from "dropsh/plugin";
import { afterEach, describe, expect, it } from "vitest";
import { createToolClient, ToolCallError } from "../../src/client.js";
import {
  startTestMcpServer,
  type TestServer,
  type TestServerOptions,
  type TestTool,
} from "./helpers/server.js";

const auth: AuthAdapter = {
  apply: async (req) => ({ ...req, headers: { ...req.headers, Authorization: "Bearer test" } }),
};

const TOOLS: TestTool[] = [
  {
    name: "echo",
    inputSchema: {
      type: "object",
      properties: { n: { type: "integer" } },
      required: ["n"],
    },
    handler: (args) => ({
      content: [{ type: "text", text: JSON.stringify(args) }],
      structuredContent: { got: args.n },
    }),
  },
  {
    name: "fail",
    inputSchema: { type: "object" },
    handler: () => ({
      content: [{ type: "text", text: "ticket already claimed" }],
      isError: true,
    }),
  },
  {
    name: "noargs",
    inputSchema: { type: "object" },
    handler: () => ({ content: [{ type: "text", text: "ok" }] }),
  },
];

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function clientFor(opts: TestServerOptions = {}) {
  server = await startTestMcpServer(TOOLS, opts);
  return createToolClient({ auth, baseUrl: server.baseUrl });
}

function countOf(method: string): number {
  return server?.methods.filter((m) => m === method).length ?? 0;
}

describe("createToolClient call", () => {
  it("rejects arguments that violate the input schema before sending", async () => {
    const client = await clientFor();
    const err = await client.call("echo", { n: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    const errors = (err as ValidationError).details.errors as Array<{ instancePath: string }>;
    expect(errors[0]?.instancePath).toBe("/n");
    expect(server?.calls).toHaveLength(0);
    await client.close();
  });

  it("returns the server's CallToolResult unchanged", async () => {
    const client = await clientFor();
    const result = await client.call("echo", { n: 2 });
    expect(result.structuredContent).toEqual({ got: 2 });
    expect(server?.calls).toEqual([{ name: "echo", args: { n: 2 } }]);
    await client.close();
  });

  it("throws ToolCallError carrying the text of an isError result", async () => {
    const client = await clientFor();
    const err = await client.call("fail", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolCallError);
    expect((err as ToolCallError).message).toBe("ticket already claimed");
    expect((err as ToolCallError).code).toBe("E_TOOL");
    expect((err as ToolCallError).details.tool).toBe("fail");
    await client.close();
  });

  it("rejects an unknown tool with the closest names and sends no tools/call", async () => {
    const client = await clientFor();
    const err = await client.call("ecco", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toContain("unknown tool 'ecco'");
    expect((err as ValidationError).details.closest).toContain("echo");
    expect(countOf("tools/call")).toBe(0);
    await client.close();
  });

  it("sends {} for a tool without declared properties", async () => {
    const client = await clientFor();
    await client.call("noargs", {});
    expect(server?.calls).toEqual([{ name: "noargs", args: {} }]);
    await client.close();
  });

  it("maps 403 to an AuthError naming the permission and mcp_server_oauth", async () => {
    const client = await clientFor({ statusFor: () => 403 });
    const err = await client.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).message).toContain("access mcp server");
    expect((err as AuthError).message).toContain("mcp_server_oauth");
    expect((err as AuthError).message).toContain(`${server?.baseUrl}/mcp`);
    await client.close();
  });

  it("maps 401 without renewal to the same AuthError", async () => {
    const client = await clientFor({ requireBearer: "Bearer other" });
    await expect(client.list()).rejects.toBeInstanceOf(AuthError);
    await client.close();
  });

  it("maps 404 to an HttpError asking whether mcp_server is enabled", async () => {
    const client = await clientFor({ statusFor: () => 404 });
    const err = await client.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(404);
    expect((err as HttpError).message).toContain("is mcp_server enabled?");
    await client.close();
  });

  it("does not retry a tools/call that failed with 502", async () => {
    const client = await clientFor({
      statusFor: (m) => (m === "tools/call" ? 502 : undefined),
    });
    const err = await client.call("noargs", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(502);
    expect(countOf("tools/call")).toBe(1);
    await client.close();
  });

  it("can connect again after a failed initialize", async () => {
    let fail = true;
    const client = await clientFor({ statusFor: () => (fail ? 503 : undefined) });
    await expect(client.list()).rejects.toBeInstanceOf(HttpError);
    fail = false;
    expect((await client.list()).map((t) => t.name)).toEqual(["echo", "fail", "noargs"]);
    await client.close();
  });
});
