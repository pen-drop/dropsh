import { ConfigError } from "dropsh/plugin";
import { describe, expect, it } from "vitest";
import { parseToolOptions } from "../../src/options.js";

describe("parseToolOptions", () => {
  it("defaults the endpoint to /mcp", () => {
    expect(parseToolOptions(undefined)).toEqual({ endpoint: "/mcp" });
    expect(parseToolOptions({})).toEqual({ endpoint: "/mcp" });
  });

  it("keeps a configured endpoint", () => {
    expect(parseToolOptions({ endpoint: "/api/mcp" })).toEqual({ endpoint: "/api/mcp" });
  });

  it("rejects a non-string or relative endpoint", () => {
    expect(() => parseToolOptions({ endpoint: 5 })).toThrow(ConfigError);
    expect(() => parseToolOptions({ endpoint: "mcp" })).toThrow(ConfigError);
  });
});
