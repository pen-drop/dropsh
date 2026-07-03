import { describe, expect, it, vi } from "vitest";
import { buildProgram, type CommandContext } from "../../src/index.js";
import type { JsonApiClient } from "../../src/core/jsonapi/client.js";
import type { DrupalCliPlugin } from "../../src/core/plugin.js";

function fakeClient(): JsonApiClient {
  return {
    get: vi.fn(async () => ({ data: { type: "node--article", id: "u1", attributes: { title: "Hi" } } })),
    post: vi.fn(async () => ({ data: { type: "node--article", id: "u2" } })),
    patch: vi.fn(async () => ({ data: { type: "node--article", id: "u1" } })),
    delete: vi.fn(async () => ({ ok: true as const })),
    upload: vi.fn(async () => ({ data: { type: "file--file", id: "f1" } })),
  };
}

const mdPlugin: DrupalCliPlugin = {
  id: "md-test",
  requiredModules: [],
  async extendSchema(_e, _b, s) { return s; },
  renderers: [{ id: "md", render: (doc) => `# ${(Array.isArray(doc.data) ? doc.data[0] : doc.data)?.id ?? ""}` }],
};

function harness(plugins: DrupalCliPlugin[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const codes: number[] = [];
  const program = buildProgram({
    plugins,
    contextFactory: async () => ({ client: fakeClient(), plugins } as unknown as CommandContext),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    setExitCode: (c) => codes.push(c),
  });
  return { program, out, err, codes };
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
});
