import { describe, expect, it, vi } from "vitest";
import { markdownPlugin } from "../../plugins/markdown/src/index.js";
import { tablePlugin } from "../../plugins/table/src/index.js";
import type { JsonApiClient } from "../../src/core/jsonapi/client.js";
import { buildProgram, type CommandContext } from "../../src/index.js";

function fakeClient(): JsonApiClient {
  return {
    get: vi.fn(async () => ({
      data: { type: "node--article", id: "u1", attributes: { title: "Hi" } },
    })),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as JsonApiClient;
}

describe("renderer plugins wired through buildProgram", () => {
  it("renders read output as markdown when both renderer plugins are loaded", async () => {
    const plugins = [markdownPlugin(), tablePlugin()];
    const out: string[] = [];
    const program = buildProgram({
      plugins,
      contextFactory: async () => ({ client: fakeClient(), plugins }) as unknown as CommandContext,
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    await program.parseAsync([
      "node",
      "dropsh",
      "--format",
      "md",
      "read",
      "node/article/abcdef01-abcd-abcd-abcd-abcdef012345",
    ]);
    expect(out.join("")).toContain("type: node--article");
    expect(out.join("")).toContain("title: Hi");
  });
});
