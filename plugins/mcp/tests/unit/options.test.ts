import { ConfigError } from "dropsh/plugin";
import { describe, expect, it } from "vitest";
import { parseMcpOptions } from "../../src/options.js";

describe("parseMcpOptions", () => {
  it("accepts required arrays and optional markdownDir", () => {
    expect(
      parseMcpOptions({
        bundles: ["node/article", "gaia_ticket/gaia_ticket"],
        operations: ["list_entities", "read", "create"],
        markdownDir: "./mcp-skills",
      }),
    ).toEqual({
      bundles: ["node/article", "gaia_ticket/gaia_ticket"],
      operations: ["list_entities", "read", "create"],
      markdownDir: "./mcp-skills",
    });
  });

  it("allows empty arrays", () => {
    expect(parseMcpOptions({ bundles: [], operations: [] })).toEqual({
      bundles: [],
      operations: [],
    });
  });

  it("rejects a missing options object", () => {
    expect(() => parseMcpOptions(undefined)).toThrow(ConfigError);
    expect(() => parseMcpOptions(undefined)).toThrow(/options object required/);
  });

  it("requires bundles and operations arrays", () => {
    expect(() => parseMcpOptions({ operations: [] })).toThrow(/bundles must be an array/);
    expect(() => parseMcpOptions({ bundles: [] })).toThrow(/operations must be an array/);
  });

  it("rejects invalid, wildcard, and duplicate bundle selectors", () => {
    expect(() => parseMcpOptions({ bundles: ["Node/article"], operations: [] })).toThrow(
      /invalid bundle selector/,
    );
    expect(() => parseMcpOptions({ bundles: ["node/*"], operations: [] })).toThrow(
      /invalid bundle selector/,
    );
    expect(() => parseMcpOptions({ bundles: ["*/*"], operations: [] })).toThrow(
      /invalid bundle selector/,
    );
    expect(() =>
      parseMcpOptions({ bundles: ["node/article", "node/article"], operations: [] }),
    ).toThrow(/duplicate bundle/);
  });

  it("rejects unknown, wildcard, and duplicate operations", () => {
    expect(() => parseMcpOptions({ bundles: [], operations: ["delete"] })).toThrow(
      /unknown operation/,
    );
    expect(() => parseMcpOptions({ bundles: [], operations: ["*"] })).toThrow(/unknown operation/);
    expect(() => parseMcpOptions({ bundles: [], operations: ["read", "read"] })).toThrow(
      /duplicate operation/,
    );
  });
});
