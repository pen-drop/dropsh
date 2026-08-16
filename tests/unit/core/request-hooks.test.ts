import { describe, expect, it, vi } from "vitest";
import type { HttpRequest } from "../../../src/core/http.js";
import type {
  DropSHPlugin,
  PluginContext,
  RequestContext,
} from "../../../src/core/plugin.js";
import { composeRequestHooks } from "../../../src/core/request-hooks.js";

const ctx: PluginContext = {
  http: { send: async () => ({ status: 200, headers: {}, body: "{}" }) },
  auth: { apply: async (req) => req },
  baseUrl: "https://example.com",
  jsonapiPrefix: "/jsonapi",
};

const req: HttpRequest = {
  method: "POST",
  url: "https://example.com/jsonapi/gaia_ticket/gaia_ticket",
  headers: {},
  body: '{"data":{}}',
};

describe("composeRequestHooks", () => {
  it("chains hooks in plugin order with request-specific context", async () => {
    const seenContexts: RequestContext[] = [];
    const plugin = (id: string): DropSHPlugin => ({
      id,
      requiredModules: [],
      async alterRequest(request, requestContext) {
        seenContexts.push(requestContext);
        return {
          ...request,
          headers: { ...request.headers, "X-Order": `${request.headers?.["X-Order"] ?? ""}${id}` },
        };
      },
    });
    const alter = composeRequestHooks([plugin("A"), plugin("B")], ctx);

    const result = await alter(req, "create", "gaia_ticket", "gaia_ticket");

    expect(result.headers?.["X-Order"]).toBe("AB");
    expect(seenContexts).toEqual([
      expect.objectContaining({
        operation: "create",
        entityType: "gaia_ticket",
        bundle: "gaia_ticket",
        baseUrl: "https://example.com",
      }),
      expect.objectContaining({
        operation: "create",
        entityType: "gaia_ticket",
        bundle: "gaia_ticket",
        baseUrl: "https://example.com",
      }),
    ]);
  });

  it("returns the same request when plugins have no alteration hook", async () => {
    const alter = composeRequestHooks([{ id: "legacy", requiredModules: [] }], ctx);

    await expect(alter(req, "create", "node", "article")).resolves.toBe(req);
  });

  it("wraps a throwing hook in a named PluginError", async () => {
    const alter = composeRequestHooks(
      [
        {
          id: "broken",
          requiredModules: [],
          async alterRequest() {
            throw new Error("boom");
          },
        },
      ],
      ctx,
    );

    await expect(alter(req, "create", "node", "article")).rejects.toMatchObject({
      name: "PluginError",
      code: "E_PLUGIN",
      details: { pluginId: "broken", hook: "alterRequest" },
    });
  });

  it("rejects an invalid result and does not run later hooks", async () => {
    const followingHook = vi.fn(async (request: HttpRequest) => request);
    const invalidPlugin = {
      id: "invalid",
      requiredModules: [],
      async alterRequest() {
        return undefined;
      },
    } as unknown as DropSHPlugin;
    const alter = composeRequestHooks(
      [
        invalidPlugin,
        { id: "following", requiredModules: [], alterRequest: followingHook },
      ],
      ctx,
    );

    await expect(alter(req, "create", "node", "article")).rejects.toMatchObject({
      name: "PluginError",
      code: "E_PLUGIN",
      details: { pluginId: "invalid", hook: "alterRequest" },
    });
    expect(followingHook).not.toHaveBeenCalled();
  });
});
