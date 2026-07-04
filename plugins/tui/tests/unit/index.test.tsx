import type { JsonApiDocument, RenderContext, RenderServices } from "dropsh/plugin";
import { describe, expect, it, vi } from "vitest";
import { initialTarget, tuiPlugin } from "../../src/index.js";

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

describe("initialTarget", () => {
  it("read of a single resource → canonical route with type/bundle/id", () => {
    const t = initialTarget({ data: { type: "node--article", id: "u1" } }, {
      command: "read",
    } as RenderContext);
    expect(t).toEqual({
      route: "entity.canonical",
      params: { type: "node", bundle: "article", id: "u1" },
    });
  });

  it("read of a collection → canonical route for the first resource", () => {
    const t = initialTarget(
      {
        data: [
          { type: "node--page", id: "p1" },
          { type: "node--page", id: "p2" },
        ],
      },
      { command: "read" } as RenderContext,
    );
    expect(t).toEqual({
      route: "entity.canonical",
      params: { type: "node", bundle: "page", id: "p1" },
    });
  });

  it("search → collection route with type and bundle from ctx", () => {
    const t = initialTarget({ data: [] }, {
      command: "search",
      entityType: "node",
      bundle: "article",
    } as RenderContext);
    expect(t).toEqual({ route: "entity.collection", params: { type: "node", bundle: "article" } });
  });

  it("search without a bundle → collection route with only type", () => {
    const t = initialTarget({ data: [] }, {
      command: "search",
      entityType: "node",
    } as RenderContext);
    expect(t).toEqual({ route: "entity.collection", params: { type: "node" } });
  });
});
