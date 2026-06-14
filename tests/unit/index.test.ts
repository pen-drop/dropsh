import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildProgram, type CommandContext, resolveAuth } from "../../src/index.js";
import { basicAuthPlugin } from "../../src/core/auth/basic.js";
import { writeSession } from "../../src/core/auth/session-store.js";
import type { JsonApiClient } from "../../src/core/jsonapi/client.js";
import type { DropSHPlugin } from "../../src/core/plugin.js";

function fakeClient(): JsonApiClient {
  return {
    get: vi.fn(async () => ({ data: { id: "u1" } })),
    post: vi.fn(async () => ({ data: { id: "u2" } })),
    patch: vi.fn(async () => ({ data: { id: "u1" } })),
    delete: vi.fn(async () => ({ ok: true })),
    upload: vi.fn(async () => ({ data: { id: "file" } })),
    collection: vi.fn(), resource: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn(), me: vi.fn(),
  };
}

describe("buildProgram", () => {
  it("registers all subcommands", () => {
    const p = buildProgram({ contextFactory: async () => ({ client: fakeClient(), plugins: [] } as unknown as CommandContext) });
    const names = p.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["auth", "create", "delete", "read", "schema", "search", "update", "upload-file"]);
  });

  it("read subcommand runs via parseAsync and writes JSON to stdout", async () => {
    const c = fakeClient();
    const out: string[] = [];
    const err: string[] = [];
    const p = buildProgram({
      contextFactory: async () => ({ client: c, plugins: [] } as unknown as CommandContext),
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    });
    await p.parseAsync(["node", "dropsh", "read", "node/article/abcdef01-abcd-abcd-abcd-abcdef012345"]);
    expect(c.get).toHaveBeenCalledWith("node/article/abcdef01-abcd-abcd-abcd-abcdef012345");
    expect(JSON.parse(out.join(""))).toEqual({ data: { id: "u1" } });
  });

  it("propagates ValidationError to stderr with exit-code signal", async () => {
    const err: string[] = [];
    const exitCodes: number[] = [];
    const p = buildProgram({
      contextFactory: async () => ({ client: fakeClient(), plugins: [] } as unknown as CommandContext),
      stdout: () => {},
      stderr: (s) => err.push(s),
      setExitCode: (code) => exitCodes.push(code),
    });
    await p.parseAsync(["node", "dropsh", "read", "bad"]);
    const parsed = JSON.parse(err.join(""));
    expect(parsed.error.code).toBe("E_VALIDATION");
    expect(exitCodes).toContain(4);
  });

  it("calls registerCommands on plugins passed to buildProgram", () => {
    const registeredCommands: string[] = [];
    const plugin: DropSHPlugin = {
      id: "test-cmd",
      requiredModules: [],
      registerCommands(program) {
        program.command("test-plugin-cmd").description("test").action(() => {});
        registeredCommands.push("test-plugin-cmd");
      },
      async extendSchema(_e, _b, s) { return s; },
    };
    const p = buildProgram({ plugins: [plugin] });
    const names = p.commands.map((c) => c.name());
    expect(names).toContain("test-plugin-cmd");
    expect(registeredCommands).toEqual(["test-plugin-cmd"]);
  });

  it("resolveAuth builds an adapter from the stored session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));
    const b64 = Buffer.from("u:p").toString("base64");
    await writeSession("https://example.com", "basic", { basic_b64: b64 }, dir);
    const adapter = await resolveAuth({
      baseUrl: "https://example.com",
      plugins: [basicAuthPlugin()],
      http: { async send() { throw new Error("unused"); } },
      now: () => 0,
      stateDir: dir,
    });
    const req = await adapter.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.Authorization).toBe(`Basic ${b64}`);
  });

  it("resolveAuth throws AuthError when there is no session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));
    await expect(
      resolveAuth({
        baseUrl: "https://example.com",
        plugins: [basicAuthPlugin()],
        http: { async send() { throw new Error("unused"); } },
        now: () => 0,
        stateDir: dir,
      }),
    ).rejects.toThrow(/auth login/);
  });
});
