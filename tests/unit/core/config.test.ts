import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/core/config.js";
import { ConfigError } from "../../../src/errors.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, "..", "fixtures", "config", name);

describe("loadConfig", () => {
  it("parses JS config and returns typed Config", async () => {
    const cfg = await loadConfig(fixture("valid.js"));
    expect(cfg.site.base_url).toBe("https://example.com");
    expect(cfg.site.jsonapi_prefix).toBe("/jsonapi");
    expect(cfg.defaults.dry_run).toBe(false);
    expect(cfg.defaults.timeout_ms).toBe(15000);
    expect(cfg.plugins).toEqual([]);
  });

  it("defaults jsonapi_prefix to /jsonapi when omitted", async () => {
    const cfg = await loadConfig(fixture("basic-noenv.js"));
    expect(cfg.site.jsonapi_prefix).toBe("/jsonapi");
  });

  it("throws ConfigError on missing file", async () => {
    await expect(loadConfig(fixture("does-not-exist.js"))).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError on missing site.base_url", async () => {
    await expect(loadConfig(fixture("no-base-url.js"))).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError on syntax error in config file", async () => {
    await expect(loadConfig(fixture("syntax-error.js"))).rejects.toBeInstanceOf(ConfigError);
  });
});
