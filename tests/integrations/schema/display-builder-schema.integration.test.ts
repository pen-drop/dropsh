import { describe, expect, it } from "vitest";
import { parseJson, runCli } from "../helpers/run.js";

function objectPath(value: unknown, path: string[]): Record<string, unknown> {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      throw new Error(`Expected object at ${path.join(".")}`);
    }
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current !== "object" || current === null || Array.isArray(current)) {
    throw new Error(`Expected object at ${path.join(".")}`);
  }
  return current as Record<string, unknown>;
}

describe("integration: Display Builder schema", () => {
  it("includes field-specific Display Builder metadata for entity-view overrides", async () => {
    const result = await runCli({
      site: "db",
      args: ["schema", "node/article", "--for=create", "--refresh"],
    });

    expect(result.code, result.stderr).toBe(0);
    const schema = parseJson<Record<string, unknown>>(result.stdout);
    const displayBuilder = objectPath(schema["x-dropsh-display-builder"], []);
    const attributes = objectPath(schema, [
      "properties",
      "data",
      "properties",
      "attributes",
      "properties",
    ]);
    const components = schema["x-dropsh-components"];

    expect(schema["x-dropsh-builder"]).toBe("display-builder");
    expect(displayBuilder.override_field).toBe("field_display_builder_override");
    expect(displayBuilder.component_library).toBeDefined();
    expect(displayBuilder.source_tree).toBeDefined();
    expect(attributes.field_display_builder_override).toBeDefined();
    expect(Array.isArray(components) ? components.length : 0).toBeGreaterThan(0);
  });
});
