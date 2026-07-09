import type { JsonApiResource } from "dropsh/plugin";
import { describe, expect, it } from "vitest";
import { label, splitType } from "../../src/jsonapi-type.js";

describe("splitType", () => {
  it("splits type--bundle", () => {
    expect(splitType("node--article")).toEqual({ entityType: "node", bundle: "article" });
  });
  it("handles a type with no bundle segment", () => {
    expect(splitType("user")).toEqual({ entityType: "user" });
  });
});

describe("label", () => {
  it("prefers title, then name, then label, else id", () => {
    expect(label({ type: "n--a", id: "1", attributes: { title: "T" } } as JsonApiResource)).toBe(
      "T",
    );
    expect(label({ type: "n--a", id: "1", attributes: { name: "N" } } as JsonApiResource)).toBe(
      "N",
    );
    expect(label({ type: "n--a", id: "1", attributes: {} } as JsonApiResource)).toBe("1");
  });
});
