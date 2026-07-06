import { describe, expect, it, vi } from "vitest";
import { createCommandContext } from "../../../src/core/context.js";
import * as configMod from "../../../src/core/config.js";
import type { AuthAdapter } from "../../../src/core/auth/types.js";
import { ConfigError } from "../../../src/errors.js";

const adapter: AuthAdapter = { apply: async (req) => req };

describe("createCommandContext", () => {
  it("builds a client from config using the auth plugin", async () => {
    vi.spyOn(configMod, "loadConfig").mockResolvedValue({
      site: { base_url: "https://x.example", jsonapi_prefix: "/jsonapi" },
      defaults: { dry_run: false, timeout_ms: 30000 },
      plugins: [
        { id: "auth", requiredModules: [], createAuthAdapter: () => adapter, async extendSchema(_e, _b, s) { return s; } },
      ],
    });
    const ctx = await createCommandContext("dropsh.config.js");
    expect(ctx.baseUrl).toBe("https://x.example");
    expect(ctx.jsonapiPrefix).toBe("/jsonapi");
    expect(typeof ctx.client.get).toBe("function");
  });

  it("throws ConfigError when no auth plugin is configured", async () => {
    vi.spyOn(configMod, "loadConfig").mockResolvedValue({
      site: { base_url: "https://x.example", jsonapi_prefix: "/jsonapi" },
      defaults: { dry_run: false, timeout_ms: 30000 },
      plugins: [],
    });
    await expect(createCommandContext("dropsh.config.js")).rejects.toBeInstanceOf(ConfigError);
  });
});
