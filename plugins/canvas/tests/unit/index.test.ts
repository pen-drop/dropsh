import { describe, expect, it } from "vitest";
import { canvasPlugin } from "../../src/index.js";

describe("canvasPlugin", () => {
  it("requires Canvas and JSON:API SDC Drupal modules", () => {
    const plugin = canvasPlugin();

    expect(plugin.id).toBe("canvas");
    expect(plugin.requiredModules).toEqual(["canvas", "jsonapi_sdc"]);
  });

  it("passes pre-operation schema through unchanged", async () => {
    const plugin = canvasPlugin();
    const schema = { type: "object" };

    await expect(plugin.extendSchema("canvas_page", "canvas_page", schema, {} as any)).resolves.toBe(
      schema,
    );
  });

  it("passes operation schema through unchanged before enrichment", async () => {
    const plugin = canvasPlugin();
    const schema = { type: "object", properties: { data: { type: "object" } } };

    await expect(
      plugin.extendOperationSchema!("canvas_page", "canvas_page", "create", schema, {} as any),
    ).resolves.toBe(schema);
  });
});
