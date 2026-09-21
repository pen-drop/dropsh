import type {
  ConfigSource,
  ConfigSourceKind,
  ConnectionEntry,
  ResolveConfigSourceInput,
  ResolveConnectionsDirInput,
} from "dropsh/plugin";
import {
  CWD_CONFIG_FILE,
  listConnectionIds,
  listConnections,
  resolveConfigSource,
  resolveConnectionsDir,
} from "dropsh/plugin";
import { describe, expect, it } from "vitest";

describe("connections exports", () => {
  it("exports the connections API from dropsh/plugin", () => {
    const sourceKind: ConfigSourceKind = "cwd";
    const source: ConfigSource = { path: "dropsh.config.js", source: sourceKind };
    const entry: ConnectionEntry = { id: "local" };
    const configInput: ResolveConfigSourceInput = { cwd: "/tmp" };
    const connectionsInput: ResolveConnectionsDirInput = { flag: "/tmp/connections" };

    expect(CWD_CONFIG_FILE).toBe("dropsh.config.js");
    expect(typeof resolveConfigSource).toBe("function");
    expect(typeof resolveConnectionsDir).toBe("function");
    expect(typeof listConnections).toBe("function");
    expect(typeof listConnectionIds).toBe("function");
    expect(source).toEqual({ path: "dropsh.config.js", source: "cwd" });
    expect(entry).toEqual({ id: "local" });
    expect(configInput).toEqual({ cwd: "/tmp" });
    expect(connectionsInput).toEqual({ flag: "/tmp/connections" });
  });
});
