import type { JsonApiClient } from "dropsh/plugin";
import { describe, expect, it, vi } from "vitest";
import { TuiEntityView } from "../../src/entity-view.js";
import { buildRegistry } from "../../src/registry.js";
import { createRouter } from "../../src/router.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(async (path: string) => ({
      data: { type: "node--article", id: path.split("/").pop() ?? "x" },
    })),
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
    await router.navigate(
      "entity.canonical",
      { type: "node", bundle: "article", id: "u1" },
      {
        data: { type: "node--article", id: "u1", attributes: { title: "Seed" } },
      },
    );
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
    const router = createRouter({
      registry: buildRegistry([]),
      client: client(),
      viewMode: "default",
    });
    await expect(router.navigate("nope", {})).rejects.toThrow(/unknown route/i);
  });

  it("passes the view mode's include hints to client.get on a non-seeded canonical fetch", async () => {
    class ArticleView extends TuiEntityView {
      static override entityType = "node";
      static override bundle = "article";
      static override viewModes = { default: { include: ["uid"] } };
      build() {
        return null as never;
      }
    }
    const get = vi.fn(
      async (_path: string, _params?: import("drupal-jsonapi-params").DrupalJsonApiParams) => ({
        data: { type: "node--article", id: "x" },
      }),
    );
    const c = {
      get,
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      upload: vi.fn(),
    } as unknown as JsonApiClient;
    const router = createRouter({
      registry: buildRegistry([{ id: "x", entities: [ArticleView] }]),
      client: c,
      viewMode: "default",
    });
    await router.navigate("entity.canonical", { type: "node", bundle: "article", id: "x" });
    expect(get.mock.calls[0]?.[1]?.getQueryString()).toContain("include=uid");
  });

  it("fetches the bundle-scoped path for a collection when no seededDoc is given", async () => {
    const c = client();
    const router = createRouter({ registry: buildRegistry([]), client: c, viewMode: "default" });
    await router.navigate("entity.collection", { type: "node", bundle: "article" });
    expect(c.get).toHaveBeenCalledWith("node/article");
  });
});
