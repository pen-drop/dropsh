import { describe, expect, it, vi } from "vitest";
import { buildProgram, type CommandContext } from "../../src/index.js";
import type { JsonApiClient } from "../../src/core/jsonapi/client.js";
import type { DropSHPlugin } from "../../src/core/plugin.js";

function fakeClient(): JsonApiClient {
  return {
    get: vi.fn(async () => ({ data: { type: "node--article", id: "u1", attributes: { title: "Hi" } } })),
    post: vi.fn(async () => ({ data: { type: "node--article", id: "u2" } })),
    patch: vi.fn(async () => ({ data: { type: "node--article", id: "u1" } })),
    delete: vi.fn(async () => ({ ok: true as const })),
    upload: vi.fn(async () => ({ data: { type: "file--file", id: "f1" } })),
    collection: vi.fn(),
    resource: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    me: vi.fn(),
  };
}

const mdPlugin: DropSHPlugin = {
  id: "md-test",
  requiredModules: [],
  async extendSchema(_e, _b, s) { return s; },
  renderers: [{ id: "md", render: (doc) => `# ${(Array.isArray(doc.data) ? doc.data[0] : doc.data)?.id ?? ""}` }],
};

function harness(plugins: DropSHPlugin[] = [], client: JsonApiClient = fakeClient()) {
  const out: string[] = [];
  const err: string[] = [];
  const codes: number[] = [];
  const program = buildProgram({
    plugins,
    contextFactory: async () => ({ client, plugins } as unknown as CommandContext),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    setExitCode: (c) => codes.push(c),
  });
  return { program, out, err, codes };
}

// A client whose `get` resolves on a macrotask (not just a microtask), so that
// only a properly-`return`ed action promise (chained by commander's parseAsync)
// will be awaited before assertions run. An unreturned `run(...)` call would
// leave `get` still pending when `parseAsync` resolves, exposing the bug this
// test guards against.
function macrotaskDelayedClient(): JsonApiClient {
  const inner = fakeClient();
  return {
    ...inner,
    get: vi.fn(
      (...args: Parameters<JsonApiClient["get"]>) =>
        new Promise((resolve, reject) => {
          setImmediate(() => {
            inner.get(...args).then(resolve, reject);
          });
        }),
    ) as unknown as JsonApiClient["get"],
  };
}

describe("--format", () => {
  it("read defaults to JSON", async () => {
    const h = harness();
    await h.program.parseAsync(["node", "dropsh", "read", "node/article/abcdef01-abcd-abcd-abcd-abcdef012345"]);
    expect(JSON.parse(h.out.join(""))).toEqual({ data: { type: "node--article", id: "u1", attributes: { title: "Hi" } } });
  });

  it("read with --format md uses the renderer", async () => {
    const h = harness([mdPlugin]);
    await h.program.parseAsync(["node", "dropsh", "--format", "md", "read", "node/article/abcdef01-abcd-abcd-abcd-abcdef012345"]);
    expect(h.out.join("")).toBe("# u1\n");
  });

  it("unknown format exits 2 before HTTP", async () => {
    const h = harness();
    const c = h.program;
    await c.parseAsync(["node", "dropsh", "--format", "md", "read", "node/article/abcdef01-abcd-abcd-abcd-abcdef012345"]);
    expect(JSON.parse(h.err.join("")).error.code).toBe("E_CONFIG");
    expect(h.codes).toContain(2);
  });

  it("format on a non-entity command (schema) exits 2", async () => {
    const h = harness([mdPlugin]);
    await h.program.parseAsync(["node", "dropsh", "--format", "md", "schema"]);
    expect(JSON.parse(h.err.join("")).error.code).toBe("E_CONFIG");
    expect(h.codes).toContain(2);
  });

  it("search with --format md uses the renderer (action promise is awaited)", async () => {
    const h = harness([mdPlugin], macrotaskDelayedClient());
    await h.program.parseAsync([
      "node",
      "dropsh",
      "--format",
      "md",
      "search",
      "node",
      "--bundle",
      "article",
    ]);
    expect(h.out.join("")).toBe("# u1\n");
  });

  it("passes viewMode and services to an interactive renderer via read", async () => {
    const run = vi.fn(async () => {});
    const tuiPluginStub: DropSHPlugin = {
      id: "tui-test",
      requiredModules: [],
      async extendSchema(_e, _b, s) { return s; },
      renderers: [{ id: "tui", interactive: true, run }],
    };
    const client = fakeClient();
    const out: string[] = [];
    const program = buildProgram({
      plugins: [tuiPluginStub],
      contextFactory: async () =>
        ({ client, baseUrl: "https://x.test", plugins: [tuiPluginStub] } as unknown as CommandContext),
      stdout: (s) => out.push(s),
      stderr: () => {},
      setExitCode: () => {},
    });
    await program.parseAsync(
      ["node", "dropsh", "--format", "tui", "--view-mode", "teaser", "read", "node/article/u1"],
    );
    expect(run).toHaveBeenCalledTimes(1);
    const call = run.mock.calls[0] as unknown as [unknown, unknown, unknown];
    const [, ctx, services] = call;
    expect(ctx).toMatchObject({ command: "read", entityType: "node", bundle: "article", viewMode: "teaser" });
    expect(services).toMatchObject({ client, baseUrl: "https://x.test" });
  });
});
