import { describe, expect, it } from "vitest";
import { createOutput } from "../../../src/core/cli/output.js";
import type { Renderer } from "../../../src/core/cli/render.js";
import { ConfigError } from "../../../src/errors.js";

const mdRenderer: Renderer = {
  id: "md",
  render: (doc) => `# ${(Array.isArray(doc.data) ? doc.data[0] : doc.data)?.id ?? ""}`,
};

function collect() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, push: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) } };
}

describe("createOutput", () => {
  it("defaults to JSON with a trailing newline (backward compatible)", () => {
    const c = collect();
    const o = createOutput({ ...c.push });
    o.emit({ data: { type: "node--article", id: "u1" } });
    expect(c.out.join("")).toBe(`${JSON.stringify({ data: { type: "node--article", id: "u1" } })}\n`);
  });

  it("routes a document through the selected renderer", () => {
    const c = collect();
    const o = createOutput({ ...c.push, renderers: [mdRenderer], getFormat: () => "md" });
    o.emit({ data: { type: "node--article", id: "u1" } }, { command: "read" });
    expect(c.out.join("")).toBe("# u1\n");
  });

  it("falls back to JSON for non-document values even under a renderer format", () => {
    const c = collect();
    const o = createOutput({ ...c.push, renderers: [mdRenderer], getFormat: () => "md" });
    o.emit({ dry_run: true, method: "POST", path: "node/article" }, { command: "create" });
    expect(c.out.join("")).toBe(`${JSON.stringify({ dry_run: true, method: "POST", path: "node/article" })}\n`);
  });

  it("hasFormat knows json and registered renderer ids", () => {
    const o = createOutput({ ...collect().push, renderers: [mdRenderer] });
    expect(o.hasFormat("json")).toBe(true);
    expect(o.hasFormat("md")).toBe(true);
    expect(o.hasFormat("table")).toBe(false);
  });

  it("throws ConfigError on duplicate renderer ids", () => {
    expect(() => createOutput({ ...collect().push, renderers: [mdRenderer, mdRenderer] }))
      .toThrow(ConfigError);
  });

  it("fail() always emits JSON to stderr", () => {
    const c = collect();
    const o = createOutput({ ...c.push, renderers: [mdRenderer], getFormat: () => "md" });
    o.fail(new ConfigError("boom"));
    expect(JSON.parse(c.err.join("")).error.code).toBe("E_CONFIG");
    expect(c.out.join("")).toBe("");
  });
});
