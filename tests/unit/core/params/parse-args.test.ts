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

  it("expands --set variadically until the next option", () => {
    expect(parseFieldArgs(["--set", "title=T", "body.value=X", "--status", "true"])).toEqual([
      { path: "title", value: "T", form: "set", hasValue: true },
      { path: "body.value", value: "X", form: "set", hasValue: true },
      { path: "status", value: "true", form: "flag", hasValue: true },
    ]);
  });

  it("keeps everything after the first = in a --set pair", () => {
    expect(parseFieldArgs(["--set", "title=a=b"])).toEqual([
      { path: "title", value: "a=b", form: "set", hasValue: true },
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

  it("rejects a --set pair without =", () => {
    expect(() => parseFieldArgs(["--set", "title"])).toThrow(/--set expects <field>=<value>/);
  });

  it("rejects --set with no pair at all", () => {
    expect(() => parseFieldArgs(["--set", "--title", "T"])).toThrow(
      /--set expects at least one <field>=<value>/,
    );
  });

  it("rejects a bare --", () => {
    expect(() => parseFieldArgs(["--"])).toThrow(ValidationError);
  });
});
