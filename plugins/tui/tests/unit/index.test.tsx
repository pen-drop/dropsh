import type { JsonApiDocument, RenderContext, RenderServices } from "dropsh/plugin";
import { describe, expect, it, vi } from "vitest";
import { tuiPlugin } from "../../src/index.js";

function services(): RenderServices {
  return {
    client: { get: vi.fn(async () => ({ data: [] })) } as never,
    baseUrl: "https://x.test",
  };
}

describe("tuiPlugin", () => {
  it("exposes an interactive renderer with id 'tui'", () => {
    const plugin = tuiPlugin();
    const renderer = plugin.renderers?.[0];
    expect(renderer?.id).toBe("tui");
    expect((renderer as { interactive?: boolean }).interactive).toBe(true);
  });

  it("run() rejects when stdout is not a TTY", async () => {
    const plugin = tuiPlugin();
    const renderer = plugin.renderers?.[0] as {
      run: (d: JsonApiDocument, c: RenderContext, s?: RenderServices) => Promise<void>;
    };
    const orig = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    await expect(
      renderer.run({ data: { type: "node--article", id: "u1" } }, { command: "read" }, services()),
    ).rejects.toThrow(/interactive terminal/i);
    Object.defineProperty(process.stdout, "isTTY", { value: orig, configurable: true });
  });
});
