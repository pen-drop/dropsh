import type { AuthAdapter } from "dropsh/plugin";
import { afterEach, describe, expect, it } from "vitest";
import { createToolClient } from "../../src/client.js";
import { startTestMcpServer, type TestServer, type TestTool } from "./helpers/server.js";

const auth: AuthAdapter = {
  apply: async (req) => ({ ...req, headers: { ...req.headers, Authorization: "Bearer test" } }),
};

const TOOLS: TestTool[] = Array.from({ length: 7 }, (_, i) => ({
  name: `t${i + 1}`,
  description: `tool ${i + 1}`,
  inputSchema: { type: "object" },
}));

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("createToolClient list/get/close", () => {
  it("follows pagination cursors and returns every tool in server order", async () => {
    server = await startTestMcpServer(TOOLS, { pageSize: 3 });
    const client = createToolClient({ auth, baseUrl: server.baseUrl });
    const list = await client.list();
    expect(list.map((t) => t.name)).toEqual(["t1", "t2", "t3", "t4", "t5", "t6", "t7"]);
    expect(list[0]).toEqual({ name: "t1", description: "tool 1", inputSchema: { type: "object" } });
    expect(server.methods.filter((m) => m === "tools/list")).toHaveLength(3);
    await client.close();
  });

  it("caches the list for the lifetime of the client", async () => {
    server = await startTestMcpServer(TOOLS, { pageSize: 3 });
    const client = createToolClient({ auth, baseUrl: server.baseUrl });
    await client.list();
    await client.list();
    expect(await client.get("t3")).toMatchObject({ name: "t3" });
    expect(await client.get("nope")).toBeUndefined();
    expect(server.methods.filter((m) => m === "tools/list")).toHaveLength(3);
    await client.close();
  });

  it("authorises every request through the auth adapter", async () => {
    server = await startTestMcpServer(TOOLS, { requireBearer: "Bearer test" });
    const client = createToolClient({ auth, baseUrl: server.baseUrl });
    await client.list();
    await client.close();
    expect(server.seenAuth.length).toBeGreaterThan(0);
    expect(new Set(server.seenAuth)).toEqual(new Set(["Bearer test"]));
  });

  it("appends the endpoint to the base URL and re-initialises after close", async () => {
    server = await startTestMcpServer(TOOLS);
    const client = createToolClient({ auth, baseUrl: `${server.baseUrl}/`, endpoint: "/mcp" });
    await client.list();
    await client.close();
    await client.list();
    await client.close();
    expect(server.methods.filter((m) => m === "initialize")).toHaveLength(2);
  });
});
