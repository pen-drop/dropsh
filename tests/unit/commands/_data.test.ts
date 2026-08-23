import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readDataArg } from "../../../src/commands/_data.js";
import { ValidationError } from "../../../src/errors.js";

describe("readDataArg", () => {
  it("parses inline JSON", async () => {
    const v = await readDataArg('{"a":1}');
    expect(v).toEqual({ a: 1 });
  });
  it("reads @file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dc-"));
    const p = path.join(dir, "d.json");
    await writeFile(p, '{"b":2}');
    const v = await readDataArg(`@${p}`);
    expect(v).toEqual({ b: 2 });
  });
  it("throws on bad JSON", async () => {
    await expect(readDataArg("not json")).rejects.toBeInstanceOf(ValidationError);
  });
  it("throws on missing file", async () => {
    await expect(readDataArg("@/does/not/exist.json")).rejects.toBeInstanceOf(ValidationError);
  });
});
