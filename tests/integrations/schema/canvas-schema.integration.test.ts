import { describe, expect, it } from "vitest";
import { parseJson, runCli } from "../helpers/run.js";

describe("integration: Canvas schema", () => {
  it("includes Canvas component metadata from jsonapi_sdc", async () => {
    const result = await runCli({
      site: "canvas",
      args: ["schema", "canvas_page/canvas_page", "--for=create", "--refresh"],
    });

    expect(result.code).toBe(0);
    // biome-ignore lint/suspicious/noExplicitAny: runtime schema shape from canvas
    const schema = parseJson<any>(result.stdout);
    expect(schema["x-dropsh-builder"]).toBe("canvas");
    expect(schema["x-dropsh-components"].length).toBeGreaterThan(0);
    expect(schema.properties.data.properties.attributes.properties.components.type).toBe("array");
  });
});
