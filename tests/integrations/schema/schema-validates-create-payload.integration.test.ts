import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseError, runCli } from "../helpers/run.js";

describe("integration: create validates payload client-side against schema", () => {
  it("rejects an invalid payload before hitting Drupal and reports E_VALIDATION (exit 4)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dropsh-payload-"));
    const badFile = join(dir, "bad.json");
    writeFileSync(
      badFile,
      JSON.stringify({ data: { type: "node--article_test", attributes: {} } }),
    );
    const result = await runCli({
      args: ["create", "node", "--bundle=article_test", `--data=@${badFile}`],
    });
    expect(result.code).toBe(4);
    const errLine =
      result.stderr.split("\n").find((l) => l.includes("E_VALIDATION")) ?? result.stderr;
    const err = parseError(errLine);
    expect(err.error.code).toBe("E_VALIDATION");
    expect(err.error.message).toMatch(/node\/article_test/);
    // biome-ignore lint/suspicious/noExplicitAny: runtime error details shape
    const errors = (err.error.details as any).errors as Array<{ instancePath: string }>;
    expect(errors.some((e) => e.instancePath.startsWith("/data/attributes"))).toBe(true);
  });

  it("--no-validate bypasses client-side check (server still rejects garbage)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dropsh-payload-"));
    const badFile = join(dir, "bad.json");
    writeFileSync(
      badFile,
      JSON.stringify({ data: { type: "node--article_test", attributes: {} } }),
    );
    const result = await runCli({
      args: ["create", "node", "--bundle=article_test", `--data=@${badFile}`, "--no-validate"],
    });
    // expect it to go to Drupal and come back with an HTTP error (exit 5)
    expect(result.code).toBe(5);
  });
});
