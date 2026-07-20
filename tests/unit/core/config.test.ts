import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectProviders } from "../../../src/core/auth/registry.js";
import { loadConfig } from "../../../src/core/config.js";
import { ConfigError } from "../../../src/errors.js";

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

  describe("plugin descriptors (import-free config)", () => {
    it("passes a pre-constructed plugin through unchanged", async () => {
      const cfg = await loadConfig(fixture("plugin-passthrough.js"));
      expect(cfg.plugins).toHaveLength(1);
      expect(cfg.plugins[0]?.id).toBe("prebuilt");
      expect(cfg.plugins[0]?.authProvider?.id).toBe("prebuilt");
    });

    it("resolves a named plugin (ESLint style) relative to the config file", async () => {
      const cfg = await loadConfig(fixture("descriptor-named-plugin.js"));
      expect(cfg.plugins).toHaveLength(1);
      expect(cfg.plugins[0]?.id).toBe("from-name");
      expect(cfg.plugins[0]?.authProvider?.id).toBe("from-name");
    });

    it("throws ConfigError when a named plugin cannot be resolved", async () => {
      await expect(loadConfig(fixture("descriptor-unknown.js"))).rejects.toBeInstanceOf(
        ConfigError,
      );
    });
  });

  describe("plugin-declared dependencies", () => {
    it("auto-loads a declared dependency, ordered before its declarer", async () => {
      const cfg = await loadConfig(fixture("deps-basic.js"));
      expect(cfg.plugins.map((p) => p.id)).toEqual(["child", "parent"]);
    });

    it("honors the descriptor form (export + with) for a dependency", async () => {
      const cfg = await loadConfig(fixture("deps-with.js"));
      expect(cfg.plugins.map((p) => p.id)).toEqual(["child-configured", "parent-with"]);
    });

    it("loads a shared dependency once (diamond graph)", async () => {
      const cfg = await loadConfig(fixture("deps-diamond.js"));
      const ids = cfg.plugins.map((p) => p.id);
      expect(ids.filter((id) => id === "d")).toHaveLength(1);
      // d before b and c; b and c before a
      expect(ids.indexOf("d")).toBeLessThan(ids.indexOf("b"));
      expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("a"));
      expect(ids.indexOf("c")).toBeLessThan(ids.indexOf("a"));
    });

    it("rejects a dependency cycle with the chain", async () => {
      await expect(loadConfig(fixture("deps-cycle.js"))).rejects.toThrow(ConfigError);
      await expect(loadConfig(fixture("deps-cycle.js"))).rejects.toThrow(
        /dep-a\.mjs.*dep-b\.mjs.*dep-a\.mjs/s,
      );
    });

    it("names the declaring parent when a dependency cannot be resolved", async () => {
      await expect(loadConfig(fixture("deps-missing.js"))).rejects.toThrow(
        /definitely-not-installed.*declared by/s,
      );
    });

    it("constructs a shared dependency once, not per incoming edge (AC-3)", async () => {
      (globalThis as { __DROPSH_DIAMOND_D_CONSTRUCTIONS?: number }).__DROPSH_DIAMOND_D_CONSTRUCTIONS = 0;
      await loadConfig(fixture("deps-diamond.js"));
      expect(
        (globalThis as { __DROPSH_DIAMOND_D_CONSTRUCTIONS?: number })
          .__DROPSH_DIAMOND_D_CONSTRUCTIONS,
      ).toBe(1);
    });

    it("does not report a false cycle when one descriptor string names different files", async () => {
      const cfg = await loadConfig(fixture("deps-false-cycle.js"));
      const ids = cfg.plugins.map((p) => p.id);
      expect(ids).toContain("leaf-root");
      expect(ids).toContain("mid");
      expect(ids).toContain("leaf-sub");
      expect(ids).toContain("fp-a");
    });

    it("loads two same-package entries that differ only by options", async () => {
      const cfg = await loadConfig(fixture("deps-dup-options.js"));
      expect(cfg.plugins.map((p) => p.id)).toEqual(["child-one", "child-two"]);
    });
  });

  describe("plugin composition (nested array / composePlugins)", () => {
    it("flattens an array returned by a descriptor factory into separate entries", async () => {
      const cfg = await loadConfig(fixture("compose-descriptor.js"));
      expect(cfg.plugins.map((p) => p.id)).toEqual(["g-one", "g-two"]);
    });

    it("flattens a nested-array plugins[] entry, expanding each child's deps first", async () => {
      const cfg = await loadConfig(fixture("compose-nested-array.js"));
      // parent declares dep on child → child before parent; inline follows.
      expect(cfg.plugins.map((p) => p.id)).toEqual(["child", "parent", "inline"]);
    });

    it("de-duplicates a child id shared across two composite entries", async () => {
      const cfg = await loadConfig(fixture("compose-dedup.js"));
      expect(cfg.plugins.map((p) => p.id)).toEqual(["shared", "only-a", "only-b"]);
    });
  });

  describe("same-package descriptor de-dup by identity, not plugin.id (DROPSH-12)", () => {
    it("keeps two distinct-option entries that share a constant plugin.id", async () => {
      const cfg = await loadConfig(fixture("descriptor-dup-const-id.js"));
      // Both instances survive resolution even though they carry the same
      // plugin.id — descriptor identity (path + export + options) is distinct.
      expect(cfg.plugins).toHaveLength(2);
      const providers = collectProviders(cfg.plugins);
      expect(providers.map((p) => p.id)).toEqual(["session", "pm"]);
    });

    it("still rejects two entries that resolve to the same auth profile id", async () => {
      const cfg = await loadConfig(fixture("descriptor-dup-auth-collision.js"));
      // Both entries are constructed and emitted (distinct descriptor identity),
      // so the auth registry's duplicate-id guard is reachable again.
      expect(cfg.plugins).toHaveLength(2);
      expect(() => collectProviders(cfg.plugins)).toThrow(ConfigError);
      expect(() => collectProviders(cfg.plugins)).toThrow(/duplicate auth profile id 'pm'/);
    });
  });
});
