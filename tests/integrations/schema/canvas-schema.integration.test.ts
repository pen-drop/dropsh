import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { testConfig } from "../helpers/config.js";

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCliWithCanvasPlugin(args: string[]): Promise<RunResult> {
  const cfg = testConfig();
  const dir = mkdtempSync(join(tmpdir(), "dropsh-canvas-it-"));
  const cfgPath = join(dir, "dropsh.config.mjs");
  const basicUrl = pathToFileURL(resolve("src/core/auth/basic.js")).href;
  const canvasUrl = pathToFileURL(resolve("plugins/canvas/src/index.js")).href;

  writeFileSync(
    cfgPath,
    [
      `import { basicAuthPlugin } from ${JSON.stringify(basicUrl)};`,
      `import { canvasPlugin } from ${JSON.stringify(canvasUrl)};`,
      "",
      "export default {",
      `  site: { base_url: ${JSON.stringify(cfg.url)}, jsonapi_prefix: "/jsonapi" },`,
      "  defaults: { dry_run: false, timeout_ms: 30000 },",
      "  plugins: [",
      `    basicAuthPlugin({ username: ${JSON.stringify(cfg.basic.user)}, password: ${JSON.stringify(cfg.basic.pass)} }),`,
      "    canvasPlugin(),",
      "  ],",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );

  return await new Promise<RunResult>((resolveResult) => {
    const child = spawn("node", ["--import", "tsx/esm", "bin/dropsh-src", ...args], {
      env: {
        ...process.env,
        DROPSH_CONFIG: cfgPath,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      resolveResult({ code: code ?? -1, stdout, stderr });
    });
  });
}

describe("integration: Canvas schema", () => {
  it("includes Canvas component metadata from jsonapi_sdc", async () => {
    const result = await runCliWithCanvasPlugin([
      "schema",
      "canvas_page/canvas_page",
      "--for=create",
      "--refresh",
    ]);

    expect(result.code).toBe(0);
    const schema = JSON.parse(result.stdout);
    expect(schema["x-dropsh-builder"]).toBe("canvas");
    expect(schema["x-dropsh-components"].length).toBeGreaterThan(0);
    expect(schema.properties.data.properties.attributes.properties.components.type).toBe("array");
  });
});
