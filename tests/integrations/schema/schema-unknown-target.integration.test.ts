import { describe, expect, it } from "vitest";
import { parseError, runCli } from "../helpers/run.js";

describe("integration: schema unknown target", () => {
  it("exits 4 with E_VALIDATION for an unknown bundle", async () => {
    const result = await runCli({
      site: "schemata",
      args: ["schema", "node/does_not_exist", "--refresh"],
    });
    expect(result.code).toBe(4);
    // stderr may contain a warning line followed by the JSON error — pick the JSON line
    const errLine =
      result.stderr.split("\n").find((l) => l.includes("E_VALIDATION")) ?? result.stderr;
    const err = parseError(errLine);
    expect(err.error.code).toBe("E_VALIDATION");
    expect(err.error.message).toMatch(/no such target/);
  });
});
