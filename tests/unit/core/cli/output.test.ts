import { describe, expect, it } from "vitest";
import { createOutput } from "../../../../src/core/cli/output.js";
import { ConfigError, HttpError } from "../../../../src/errors.js";

describe("createOutput", () => {
  it("writes JSON to stdout", () => {
    const out: string[] = []; const err: string[] = [];
    const o = createOutput({ stdout: (s) => out.push(s), stderr: (s) => err.push(s) });
    o.emit({ hello: "world" });
    expect(out.join("")).toBe('{"hello":"world"}\n');
    expect(err).toHaveLength(0);
  });

  it("writes structured error to stderr for CliError", () => {
    const err: string[] = [];
    const o = createOutput({ stdout: () => {}, stderr: (s) => err.push(s) });
    o.fail(new ConfigError("bad", { where: "x" }));
    const parsed = JSON.parse(err.join(""));
    expect(parsed.error.code).toBe("E_CONFIG");
    expect(parsed.error.message).toBe("bad");
    expect(parsed.error.details).toEqual({ where: "x" });
  });

  it("preserves HTTP body in details", () => {
    const err: string[] = [];
    const o = createOutput({ stdout: () => {}, stderr: (s) => err.push(s) });
    o.fail(new HttpError(422, "bad", { errors: [{ title: "x" }] }));
    const parsed = JSON.parse(err.join(""));
    expect(parsed.error.details.status).toBe(422);
    expect(parsed.error.details.body).toEqual({ errors: [{ title: "x" }] });
  });

  it("wraps non-CliError as E_UNKNOWN", () => {
    const err: string[] = [];
    const o = createOutput({ stdout: () => {}, stderr: (s) => err.push(s) });
    o.fail(new Error("oops"));
    const parsed = JSON.parse(err.join(""));
    expect(parsed.error.code).toBe("E_UNKNOWN");
    expect(parsed.error.message).toBe("oops");
  });
});
