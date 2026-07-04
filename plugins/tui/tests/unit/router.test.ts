import type { JsonApiClient } from "dropsh/plugin";
import { describe, expect, it, vi } from "vitest";
import { buildRegistry } from "../../src/registry.js";
import { createRouter } from "../../src/router.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(async (path: string) => ({ data: { type: "node--article", id: path.split("/").pop() ?? "x" } })),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as JsonApiClient;
}

describe("createRouter", () => {
  it("uses the seeded doc without fetching on the first navigate", async () => {
    const c = client();
    const router = createRouter({ registry: buildRegistry([]), client: c, viewMode: "default" });
    await router.navigate("entity.canonical", { type: "node", bundle: "article", id: "u1" }, {
      data: { type: "node--article", id: "u1", attributes: { title: "Seed" } },
    });
    expect(router.stackDepth()).toBe(1);
    expect(c.get).not.toHaveBeenCalled();
  });

  it("fetches (upcasts) when navigating without a seeded doc, and back() pops", async () => {
    const c = client();
    const router = createRouter({ registry: buildRegistry([]), client: c, viewMode: "default" });
    await router.navigate("entity.canonical", { type: "node", bundle: "article", id: "u1" });
    await router.navigate("entity.canonical", { type: "user", id: "a1" });
    expect(c.get).toHaveBeenCalledTimes(2);
    expect(router.stackDepth()).toBe(2);
    expect(router.back()).toBe(true);
    expect(router.stackDepth()).toBe(1);
    expect(router.back()).toBe(false);
  });

  it("throws on an unknown route name", async () => {
    const router = createRouter({ registry: buildRegistry([]), client: client(), viewMode: "default" });
    await expect(router.navigate("nope", {})).rejects.toThrow(/unknown route/i);
  });
});
