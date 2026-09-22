import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { defaultStateDir } from "../../../src/core/auth/session-store.js";
import { loadConfig } from "../../../src/core/config.js";
import {
  listConnections,
  resolveConfigSource,
  resolveConnectionsDir,
} from "../../../src/core/connections.js";
import { defaultConnectionsDir } from "../../../src/core/paths.js";
import { ConfigError } from "../../../src/errors.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const connectionsDir = path.join(here, "..", "fixtures", "connections");
const cwd = path.join(here, "..", "fixtures", "config");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function connectionFixture(ids: string[]): { root: string; connections: string } {
  const root = mkdtempSync(path.join(tmpdir(), "dropsh-connections-"));
  temporaryRoots.push(root);
  const connections = path.join(root, "connections");
  mkdirSync(connections);
  for (const id of ids) writeFileSync(path.join(connections, `${id}.js`), "export default {};\n");
  return { root, connections };
}

describe("resolveConnectionsDir", () => {
  it("defaults to the state dir's connections folder", () => {
    expect(resolveConnectionsDir({ env: {} })).toBe(path.join(defaultStateDir(), "connections"));
    expect(resolveConnectionsDir({ env: {} })).toBe(defaultConnectionsDir());
  });

  it("uses $DROPSH_CONNECTIONS_DIR when no flag is given", () => {
    expect(resolveConnectionsDir({ env: { DROPSH_CONNECTIONS_DIR: "/tmp/conns" } })).toBe(
      "/tmp/conns",
    );
  });

  it("lets the flag win over the environment variable", () => {
    expect(
      resolveConnectionsDir({ flag: "/tmp/flag", env: { DROPSH_CONNECTIONS_DIR: "/tmp/env" } }),
    ).toBe("/tmp/flag");
  });
});

describe("resolveConfigSource", () => {
  it("resolves a connection id to its file, and loadConfig reads that site", async () => {
    const resolved = resolveConfigSource({ connection: "staging", connectionsDir, env: {}, cwd });
    expect(resolved).toEqual({
      path: path.join(connectionsDir, "staging.js"),
      source: "flag-connection",
      id: "staging",
    });
    const cfg = await loadConfig(resolved.path);
    expect(cfg.site.base_url).toBe("https://staging.example.com");
  });

  const everyLowerTier = {
    connection: "staging",
    env: { DROPSH_CONFIG: "/tmp/env-config.js", DROPSH_CONNECTION: "production" },
  };

  it("lets --config win over every lower tier", () => {
    expect(
      resolveConfigSource({ config: "/tmp/flag.js", connectionsDir, cwd, ...everyLowerTier }),
    ).toEqual({ path: "/tmp/flag.js", source: "flag-config" });
  });

  it("lets --connection win over $DROPSH_CONFIG and below", () => {
    expect(resolveConfigSource({ connectionsDir, cwd, ...everyLowerTier })).toEqual({
      path: path.join(connectionsDir, "staging.js"),
      source: "flag-connection",
      id: "staging",
    });
  });

  it("lets $DROPSH_CONFIG win over $DROPSH_CONNECTION and the cwd default", () => {
    expect(
      resolveConfigSource({
        connectionsDir,
        cwd,
        env: { DROPSH_CONFIG: "/tmp/env-config.js", DROPSH_CONNECTION: "production" },
      }),
    ).toEqual({ path: "/tmp/env-config.js", source: "env-config" });
  });

  it("lets $DROPSH_CONNECTION win over the cwd default", () => {
    expect(
      resolveConfigSource({ connectionsDir, cwd, env: { DROPSH_CONNECTION: "production" } }),
    ).toEqual({
      path: path.join(connectionsDir, "production.js"),
      source: "env-connection",
      id: "production",
    });
  });

  it("falls back to the cwd dropsh.config.js", () => {
    expect(resolveConfigSource({ connectionsDir, cwd, env: {} })).toEqual({
      path: path.join(cwd, "dropsh.config.js"),
      source: "cwd",
    });
  });

  it("uses the sole named connection when the default config is absent", () => {
    const fixture = connectionFixture(["only"]);

    expect(
      resolveConfigSource({ connectionsDir: fixture.connections, cwd: fixture.root, env: {} }),
    ).toEqual({
      path: path.join(fixture.connections, "only.js"),
      source: "sole-connection",
      id: "only",
    });
  });

  it("keeps an existing embedder default ahead of a sole named connection", () => {
    const fixture = connectionFixture(["only"]);
    const defaultConfig = path.join(fixture.root, "gaia.config.js");
    writeFileSync(defaultConfig, "export default {};\n");

    expect(
      resolveConfigSource({
        connectionsDir: fixture.connections,
        defaultConfig,
        cwd: fixture.root,
        env: {},
      }),
    ).toEqual({ path: defaultConfig, source: "default-config" });
  });

  it("does not guess when multiple named connections exist", () => {
    const fixture = connectionFixture(["first", "second"]);

    expect(
      resolveConfigSource({ connectionsDir: fixture.connections, cwd: fixture.root, env: {} }),
    ).toEqual({
      path: path.join(fixture.root, "dropsh.config.js"),
      source: "cwd",
    });
  });

  it("resolves --config and --connection together to the path, without erroring", () => {
    expect(
      resolveConfigSource({
        config: "/tmp/flag.js",
        connection: "staging",
        connectionsDir,
        cwd,
        env: {},
      }),
    ).toEqual({ path: "/tmp/flag.js", source: "flag-config" });
  });

  it("throws ConfigError naming the id, the directory and the available ids", () => {
    let err: unknown;
    try {
      resolveConfigSource({ connection: "stagng", connectionsDir, cwd, env: {} });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const message = (err as ConfigError).message;
    expect(message).toContain("stagng");
    expect(message).toContain(connectionsDir);
    expect(message).toContain("production");
    expect(message).toContain("staging");
  });

  it("reports an absent directory rather than listing ids", () => {
    const missing = path.join(connectionsDir, "does-not-exist");
    expect(() =>
      resolveConfigSource({ connection: "staging", connectionsDir: missing, cwd, env: {} }),
    ).toThrow(/no connections found in/);
  });
});

describe("listConnections", () => {
  it("lists one row per .js file, by basename, sorted, ignoring other files", async () => {
    const before = readdirSync(connectionsDir).sort();
    const rows = await listConnections(connectionsDir);
    expect(rows.map((r) => r.id)).toEqual(["broken", "production", "staging", "with-plugin"]);
    // No registry, index or map is read or written.
    expect(readdirSync(connectionsDir).sort()).toEqual(before);
  });

  it("reports each connection's site.base_url", async () => {
    const rows = await listConnections(connectionsDir);
    expect(rows.find((r) => r.id === "production")?.baseUrl).toBe("https://production.example.com");
    expect(rows.find((r) => r.id === "staging")?.baseUrl).toBe("https://staging.example.com");
  });

  it("reads site.base_url without constructing plugins", async () => {
    const rows = await listConnections(connectionsDir);
    const row = rows.find((r) => r.id === "with-plugin");
    expect(row?.baseUrl).toBe("https://with-plugin.example.com");
    expect(row?.error).toBeUndefined();
  });

  it("lists a broken connection as a row carrying its error", async () => {
    const rows = await listConnections(connectionsDir);
    const broken = rows.find((r) => r.id === "broken");
    expect(broken?.baseUrl).toBeUndefined();
    expect(broken?.error).toContain("site");
  });

  it("returns an empty list for an absent directory", async () => {
    expect(await listConnections(path.join(connectionsDir, "nope"))).toEqual([]);
  });
});
