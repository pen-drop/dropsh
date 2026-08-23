import { describe, expect, it } from "vitest";
import { parseFieldArgs } from "../../../../src/core/params/parse-args.js";
import { ValidationError } from "../../../../src/errors.js";

describe("parseFieldArgs", () => {
  it("returns an empty list for no tokens", () => {
    expect(parseFieldArgs([])).toEqual([]);
  });

  it("reads --field value pairs in argv order", () => {
    expect(parseFieldArgs(["--title", "Test", "--body.value", "Text"])).toEqual([
      { path: "title", value: "Test", form: "flag", hasValue: true },
      { path: "body.value", value: "Text", form: "flag", hasValue: true },
    ]);
  });

  it("reads the --field=value form", () => {
    expect(parseFieldArgs(["--title=Hello World"])).toEqual([
      { path: "title", value: "Hello World", form: "flag", hasValue: true },
    ]);
  });

  it("keeps a value that starts with -- when given via =", () => {
    expect(parseFieldArgs(["--title=--weird"])).toEqual([
      { path: "title", value: "--weird", form: "flag", hasValue: true },
    ]);
  });

  it("marks a bare flag as having no value", () => {
    expect(parseFieldArgs(["--status", "--title", "T"])).toEqual([
      { path: "status", value: "", form: "flag", hasValue: false },
      { path: "title", value: "T", form: "flag", hasValue: true },
    ]);
  });

  it("never comma-splits a value", () => {
    expect(parseFieldArgs(["--title", "a, b"])).toEqual([
      { path: "title", value: "a, b", form: "flag", hasValue: true },
    ]);
  });

  it("keeps everything after the first = in a --field=value pair", () => {
    expect(parseFieldArgs(["--title=a=b"])).toEqual([
      { path: "title", value: "a=b", form: "flag", hasValue: true },
    ]);
  });

  it("takes an arbitrary number of key=value pairs in one invocation", () => {
    expect(parseFieldArgs(["--title=T", "--body.value=X", "--weight=3", "--status=true"])).toEqual([
      { path: "title", value: "T", form: "flag", hasValue: true },
      { path: "body.value", value: "X", form: "flag", hasValue: true },
      { path: "weight", value: "3", form: "flag", hasValue: true },
      { path: "status", value: "true", form: "flag", hasValue: true },
    ]);
  });

  it("no longer treats --set as a collector; it is an ordinary field name", () => {
    expect(parseFieldArgs(["--set", "title=T"])).toEqual([
      { path: "set", value: "title=T", form: "flag", hasValue: true },
    ]);
  });

  it("reads --json as a raw JSON value", () => {
    expect(parseFieldArgs(["--json", 'links=[{"uri":"https://x"}]'])).toEqual([
      { path: "links", value: '[{"uri":"https://x"}]', form: "json", hasValue: true },
    ]);
  });

  it("repeats a path when the flag repeats", () => {
    expect(parseFieldArgs(["--field_tags", "u1", "--field_tags", "u2"])).toEqual([
      { path: "field_tags", value: "u1", form: "flag", hasValue: true },
      { path: "field_tags", value: "u2", form: "flag", hasValue: true },
    ]);
  });

  it("rejects a positional in the field region", () => {
    expect(() => parseFieldArgs(["oops"])).toThrow(ValidationError);
    expect(() => parseFieldArgs(["oops"])).toThrow(/unexpected argument "oops"/);
  });

  it("rejects a --json pair without =", () => {
    expect(() => parseFieldArgs(["--json", "links"])).toThrow(/--json expects <field>=<value>/);
  });

  it("rejects --json with no pair at all", () => {
    expect(() => parseFieldArgs(["--json", "--title", "T"])).toThrow(
      /--json expects at least one <field>=<value>/,
    );
  });

  it("rejects a bare --", () => {
    expect(() => parseFieldArgs(["--"])).toThrow(ValidationError);
  });
});
