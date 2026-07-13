import { describe, expect, it } from "vitest";
import { parseDdevName, siteUrl } from "../../integrations/helpers/config.js";

describe("parseDdevName", () => {
  it("extracts the top-level name value", () => {
    expect(parseDdevName("name: my-project\nother: x")).toBe("my-project");
  });
  it("ignores indented name-like lines under additional_hostnames", () => {
    expect(parseDdevName("name: base\nadditional_hostnames:\n  - schemata.base")).toBe("base");
  });
  it("returns null when no name key is present", () => {
    expect(parseDdevName("foo: bar")).toBeNull();
  });
});

describe("siteUrl", () => {
  it("plain site uses the bare project host", () => {
    expect(siteUrl("plain", "proj")).toBe("http://proj.ddev.site");
  });
  it("subsites are prefixed with the site name", () => {
    expect(siteUrl("schemata", "proj")).toBe("http://schemata.proj.ddev.site");
    expect(siteUrl("db", "proj")).toBe("http://db.proj.ddev.site");
  });
});
