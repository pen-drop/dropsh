import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import type { AuthAdapter, CommandContext, PluginCommandServices } from "dropsh/plugin";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toolPlugin } from "../../src/index.js";
import { startTestMcpServer, type TestServer, type TestTool } from "./helpers/server.js";

const auth: AuthAdapter = {
  apply: async (req) => ({ ...req, headers: { ...req.headers, Authorization: "Bearer test" } }),
};

const TOOLS: TestTool[] = [
  {
    name: "echo",
    title: "Echo",
    description: "echoes n",
    inputSchema: {
      type: "object",
      properties: { n: { type: "integer" }, s: { type: "string" } },
      required: ["n"],
    },
    handler: (args) => ({
      content: [{ type: "text", text: "done" }],
      structuredContent: { got: args.n, s: args.s },
    }),
  },
  {
    name: "plain",
    inputSchema: { type: "object" },
    handler: () => ({ content: [{ type: "text", text: "hello" }] }),
  },
  {
    name: "fail",
    inputSchema: { type: "object" },
    handler: () => ({ content: [{ type: "text", text: "ticket already claimed" }], isError: true }),
  },
];

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

async function run(args: string[]) {
  server ??= await startTestMcpServer(TOOLS);
  const baseUrl = server.baseUrl;
  const stderr: string[] = [];
  const stdout: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((s) => {
    stdout.push(String(s));
    return true;
  });
  const services: PluginCommandServices = {
    getContext: async () => ({ auth, baseUrl }) as unknown as CommandContext,
    stderr: (s) => stderr.push(s),
  };
  const program = new Command().exitOverride();
  toolPlugin().registerCommands?.(program, services);
  await program.parseAsync(["node", "dropsh", "tool", ...args]);
  vi.mocked(process.stdout.write).mockRestore();
  const exitCode = process.exitCode ?? 0;
  process.exitCode = undefined;
  const out = stdout.join("");
  const err = stderr.join("");
  return {
    exitCode,
    out: out ? JSON.parse(out) : undefined,
    err: err ? (JSON.parse(err) as { error: { code: string; message: string } }) : undefined,
  };
}

describe("dropsh tool", () => {
  it("lists every tool with name, title and description", async () => {
    const r = await run([]);
    expect(r.exitCode).toBe(0);
    expect(r.out).toEqual([
      { name: "echo", title: "Echo", description: "echoes n" },
      { name: "plain" },
      { name: "fail" },
    ]);
  });

  it("prints the input schema with --schema", async () => {
    const r = await run(["echo", "--schema"]);
    expect(r.exitCode).toBe(0);
    expect(r.out).toEqual({ name: "echo", inputSchema: TOOLS[0]?.inputSchema });
  });

  it("calls a tool with --data and --param and prints structuredContent", async () => {
    const file = join(tmpdir(), `dropsh-tool-${process.pid}.json`);
    await writeFile(file, '{"n":1,"s":"from-file"}');
    const r = await run(["echo", "--data", `@${file}`, "--param", "n=5"]);
    expect(r.exitCode).toBe(0);
    expect(r.out).toEqual({ got: 5, s: "from-file" });
    expect(server?.calls).toEqual([{ name: "echo", args: { n: 5, s: "from-file" } }]);
  });

  it("prints text content when the tool returns no structuredContent", async () => {
    const r = await run(["plain"]);
    expect(r.exitCode).toBe(0);
    expect(r.out).toEqual(["hello"]);
  });

  it("rejects an invalid argument with exit 4 and sends no tools/call", async () => {
    const r = await run(["echo", "--param", "n=abc"]);
    expect(r.exitCode).toBe(4);
    expect(r.err?.error.code).toBe("E_VALIDATION");
    expect(server?.calls).toHaveLength(0);
  });

  it("exits 1 with the tool's message when the tool reports an error", async () => {
    const r = await run(["fail"]);
    expect(r.exitCode).toBe(1);
    expect(r.err?.error.code).toBe("E_TOOL");
    expect(r.err?.error.message).toBe("ticket already claimed");
  });

  it("exits 4 for an unknown tool, naming the closest names", async () => {
    const r = await run(["ech"]);
    expect(r.exitCode).toBe(4);
    expect(r.err?.error.message).toContain("unknown tool 'ech'");
    expect(r.err?.error.message).toContain("echo");
  });

  it("exits 5 naming the endpoint when the site has no MCP endpoint", async () => {
    server = await startTestMcpServer(TOOLS, { statusFor: () => 404 });
    const r = await run([]);
    expect(r.exitCode).toBe(5);
    expect(r.err?.error.message).toContain(`${server.baseUrl}/mcp`);
    expect(r.err?.error.message).toContain("is mcp_server enabled?");
  });
});
