import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/core/config.js";
import { ConfigError } from "../../../src/errors.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  path.join(here, "..", "fixtures", "config", name);

describe("loadConfig", () => {
  it("parses YAML and expands ${ENV}", async () => {
    const env = { TEST_USER: "alice", TEST_PASS: "s3cret" };
    const cfg = await loadConfig(fixture("valid.yml"), { env });
    expect(cfg.site.base_url).toBe("https://example.com");
    expect(cfg.site.jsonapi_prefix).toBe("/jsonapi");
    expect(cfg.site.auth).toEqual({ type: "basic", username: "alice", password: "s3cret" });
    expect(cfg.defaults.dry_run).toBe(false);
    expect(cfg.defaults.timeout_ms).toBe(15000);
  });

  it("defaults jsonapi_prefix to /jsonapi when omitted", async () => {
    const cfg = await loadConfig(fixture("valid.yml"), { env: { TEST_USER: "a", TEST_PASS: "b" } });
    expect(cfg.site.jsonapi_prefix).toBe("/jsonapi");
  });

  it("throws ConfigError on missing env var", async () => {
    await expect(loadConfig(fixture("missing-env.yml"), { env: {} })).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError on missing file", async () => {
    await expect(loadConfig(fixture("does-not-exist.yml"), { env: {} })).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError on missing site.base_url", async () => {
    const tmp = path.join(here, "..", "fixtures", "config", "no-base.yml");
    // File is created inline by the next test or can be prebuilt. For this test,
    // we test the schema path via a parsed object:
    await expect(
      loadConfig(fixture("valid.yml"), {
        env: { TEST_USER: "a", TEST_PASS: "b" },
        // Override parser to simulate missing base_url:
        parse: () => ({ site: { auth: { type: "basic" } }, defaults: {} }) as unknown,
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });
});
