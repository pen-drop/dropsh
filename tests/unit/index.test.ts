import { describe, expect, it, vi } from "vitest";
import { buildProgram, normalizeInclude, type CommandContext } from "../../src/index.js";
import type { JsonApiClient } from "../../src/core/jsonapi/client.js";
import type { DrupalCliPlugin } from "../../src/core/plugin.js";

function fakeClient(): JsonApiClient {
  return {
    get: vi.fn(async () => ({ data: { id: "u1" } })),
    post: vi.fn(async () => ({ data: { id: "u2" } })),
    patch: vi.fn(async () => ({ data: { id: "u1" } })),
    delete: vi.fn(async () => ({ ok: true })),
    upload: vi.fn(async () => ({ data: { id: "file" } })),
  };
}

describe("normalizeInclude", () => {
  it("returns an empty array for undefined", () => {
    expect(normalizeInclude(undefined)).toEqual([]);
  });

  it("passes through a plain variadic list", () => {
    expect(normalizeInclude(["field_related", "field_image"])).toEqual([
      "field_related",
      "field_image",
    ]);
  });

  it("splits comma-separated entries and trims whitespace", () => {
    expect(normalizeInclude(["field_related, field_image", " field_tags "])).toEqual([
      "field_related",
      "field_image",
      "field_tags",
    ]);
  });

  it("drops empty strings produced by trailing commas or blanks", () => {
    expect(normalizeInclude(["field_related,,", "  ", ""])).toEqual(["field_related"]);
  });
});

describe("buildProgram", () => {
  it("registers all subcommands", () => {
    const p = buildProgram({ contextFactory: async () => ({ client: fakeClient(), plugins: [] } as unknown as CommandContext) });
    const names = p.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["create", "delete", "read", "schema", "search", "update", "upload-file"]);
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

  it("read subcommand forwards --include as JSON:API params", async () => {
    const c = fakeClient();
    const p = buildProgram({
      contextFactory: async () => ({ client: c, plugins: [] } as unknown as CommandContext),
      stdout: () => {},
      stderr: () => {},
    });
    await p.parseAsync([
      "node",
      "dropsh",
      "read",
      "node/article/abcdef01-abcd-abcd-abcd-abcdef012345",
      "--include",
      "field_related,field_image",
    ]);
    const [target, params] = (c.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(target).toBe("node/article/abcdef01-abcd-abcd-abcd-abcdef012345");
    expect(params.getQueryString({ encode: false })).toBe(
      "include=field_related,field_image",
    );
  });

  it("search subcommand forwards --include alongside filters and limit", async () => {
    const c = fakeClient();
    const p = buildProgram({
      contextFactory: async () => ({ client: c, plugins: [] } as unknown as CommandContext),
      stdout: () => {},
      stderr: () => {},
    });
    await p.parseAsync([
      "node",
      "dropsh",
      "search",
      "node",
      "--bundle",
      "article",
      "--include",
      "field_related",
      "field_image",
    ]);
    const [path, params] = (c.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(path).toBe("node/article");
    expect(params.getQueryString({ encode: false })).toBe(
      "include=field_related,field_image&page[limit]=50",
    );
  });

  it("uses createAuthAdapter from plugin when present", async () => {
    const mockAdapter = { apply: async (req: any) => req };
    const plugin: DrupalCliPlugin = {
      id: "test-auth",
      requiredModules: [],
      createAuthAdapter: () => mockAdapter,
      async extendSchema(_e, _b, s) { return s; },
    };
    let capturedAuth: any;
    const p = buildProgram({
      contextFactory: async () => {
        const { ConfigError } = await import("../../src/errors.js");
        const authPlugin = [plugin].find(p => p.createAuthAdapter);
        if (!authPlugin) throw new ConfigError("No auth plugin configured.");
        capturedAuth = authPlugin.createAuthAdapter!();
        return { client: fakeClient(), http: {} as any, auth: capturedAuth, baseUrl: "https://x", jsonapiPrefix: "/jsonapi", cwd: ".", plugins: [plugin] };
      },
      stdout: () => {},
      stderr: () => {},
    });
    await p.parseAsync(["node", "dropsh", "read", "node/article/abcdef01-abcd-abcd-abcd-abcdef012345"]);
    expect(capturedAuth).toBe(mockAdapter);
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
    const plugin: DrupalCliPlugin = {
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
});
