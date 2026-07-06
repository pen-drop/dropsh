import { describe, expect, it, vi } from "vitest";
import { basicAuthPlugin } from "../../../src/core/auth/basic.js";
import * as configMod from "../../../src/core/config.js";
import { createCommandContext } from "../../../src/core/context.js";
import { AuthError } from "../../../src/errors.js";

describe("createCommandContext", () => {
  it("throws AuthError when there is no stored session", async () => {
    vi.spyOn(configMod, "loadConfig").mockResolvedValue({
      site: { base_url: "https://context-test.example", jsonapi_prefix: "/jsonapi" },
      defaults: { dry_run: false, timeout_ms: 30000 },
      plugins: [basicAuthPlugin()],
    });
    await expect(createCommandContext("dropsh.config.js")).rejects.toBeInstanceOf(AuthError);
  });
});
