import { describe, expect, it } from "vitest";
import { parseError, parseJson, runCli } from "./helpers/run.js";

// Integration coverage for the jsonapi-schema plugin against a live Drupal 11
// site with the jsonapi_schema module enabled (the "jsonapischema" subsite).
//
// Mirrors the ticket's Gherkin: an authoritative, constraint-bearing write
// schema replaces the heuristic fallback, and invalid payloads are rejected
// client-side without --no-validate. The URI-format case is unit-covered in
// tests/unit/core/schema/validate.test.ts; here we exercise the equivalent
// constraint mechanism (required field + maxLength) on the fixture's article
// bundle, which the heuristic schema could never enforce.

describe("integration: jsonapi-schema plugin", () => {
  it("serves an authoritative, constraint-bearing schema for create", async () => {
    const res = await runCli({
      site: "jsonapischema",
      args: ["schema", "node/article", "--for", "create"],
    });
    expect(res.code).toBe(0);
    const schema = parseJson<Record<string, unknown>>(res.stdout);
    expect(schema["x-dropsh-source"]).toBe("jsonapi-schema");
    // No "no schema plugin configured" heuristic warning.
    expect(res.stderr).not.toMatch(/no schema plugin/i);
    // Declares required fields and field formats.
    const json = JSON.stringify(schema);
    expect(json).toContain('"required"');
    expect(json).toContain('"format"');
    // The article title is required.
    // biome-ignore lint/suspicious/noExplicitAny: deep external schema shape
    const attrs = (schema as any).properties?.data?.properties?.attributes;
    expect(attrs?.required).toContain("title");
    expect(attrs?.properties?.title?.maxLength).toBe(255);
  });

  it("serves an authoritative schema for update", async () => {
    const res = await runCli({
      site: "jsonapischema",
      args: ["schema", "node/article", "--for", "update"],
    });
    expect(res.code).toBe(0);
    const schema = parseJson<Record<string, unknown>>(res.stdout);
    expect(schema["x-dropsh-source"]).toBe("jsonapi-schema");
  });

  it("rejects an invalid payload client-side without --no-validate", async () => {
    // Missing the required `title` attribute — the heuristic schema does not
    // know it is required, so this only fails once a constraint-bearing schema
    // is in play.
    const payload = { data: { type: "node--article", attributes: {} } };
    const res = await runCli({
      site: "jsonapischema",
      args: ["create", "node", "--bundle=article", `--data=${JSON.stringify(payload)}`],
    });
    expect(res.code).not.toBe(0);
    const err = parseError(res.stderr);
    expect(JSON.stringify(err)).toMatch(/title/);
  });

  it("accepts the same payload when the required field is present", async () => {
    const payload = {
      data: { type: "node--article", attributes: { title: `it-${crypto.randomUUID()}` } },
    };
    const res = await runCli({
      site: "jsonapischema",
      args: ["create", "node", "--bundle=article", `--data=${JSON.stringify(payload)}`],
    });
    expect(res.code).toBe(0);
    const body = parseJson<{ data: { id: string } }>(res.stdout);
    expect(body.data.id).toBeTruthy();
  });
});
