import { ValidationError } from "dropsh/plugin";
import { describe, expect, it } from "vitest";
import { buildArguments } from "../../src/args.js";

const SCHEMA = {
  type: "object",
  properties: {
    n: { type: "integer" },
    x: { type: "number" },
    b: { type: "boolean" },
    o: { type: "object" },
    a: { type: "array" },
    s: { type: "string" },
  },
};

describe("buildArguments", () => {
  it("coerces --param values by the declared property type", () => {
    expect(
      buildArguments(SCHEMA, undefined, ["n=3", "x=1.5", "b=true", 'o={"k":1}', "a=[1,2]", "s=12"]),
    ).toEqual({ n: 3, x: 1.5, b: true, o: { k: 1 }, a: [1, 2], s: "12" });
  });

  it("keeps a non-numeric value for a numeric property so validation reports it", () => {
    expect(buildArguments(SCHEMA, undefined, ["n=abc", "b=yes"])).toEqual({ n: "abc", b: "yes" });
  });

  it("splits on the first '='", () => {
    expect(buildArguments(SCHEMA, undefined, ["s=a=b"])).toEqual({ s: "a=b" });
  });

  it("lets --param override keys from --data", () => {
    expect(buildArguments(SCHEMA, { n: 1, s: "keep" }, ["n=2"])).toEqual({ n: 2, s: "keep" });
  });

  it("keeps an undeclared --param as a string", () => {
    expect(buildArguments(SCHEMA, undefined, ["extra=1"])).toEqual({ extra: "1" });
  });

  it("rejects a --param without '='", () => {
    expect(() => buildArguments(SCHEMA, undefined, ["a"])).toThrow(ValidationError);
  });

  it("rejects --data that is not a JSON object", () => {
    expect(() => buildArguments(SCHEMA, [1], [])).toThrow(ValidationError);
    expect(() => buildArguments(SCHEMA, "x", [])).toThrow(ValidationError);
  });

  it("rejects invalid JSON for an object or array property", () => {
    expect(() => buildArguments(SCHEMA, undefined, ["o={nope"])).toThrow(ValidationError);
  });
});
