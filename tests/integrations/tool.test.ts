import { describe, expect, it } from "vitest";
import { TOOLS_FIXTURE_TOOL } from "./helpers/config.js";
import { basicAuth, parseError, parseJson, runCli } from "./helpers/run.js";

// Integration coverage for @dropsh/plugin-tool against the "tools" subsite:
// Tool API + Tool Belt + mcp_server + mcp_server_tool_bridge + mcp_server_oauth,
// exposing Tool Belt's entity_create as TOOLS_FIXTURE_TOOL (fixtures/setup-tools.php).

type ToolSummary = { name: string; title?: string; description?: string };

async function searchByTitle(title: string): Promise<string[]> {
  const result = await runCli({
    site: "tools",
    args: ["search", "node", "--bundle=article_test", `--filter=title:${title}`],
  });
  return parseJson<{ data: Array<{ id: string }> }>(result.stdout).data.map((item) => item.id);
}

describe("integration: dropsh tool", () => {
  it("lists the tools the credentials can see (AC-1)", async () => {
    const res = await runCli({ site: "tools", args: ["tool"] });
    expect(res.code, res.stderr).toBe(0);
    const names = parseJson<ToolSummary[]>(res.stdout).map((t) => t.name);
    expect(names).toContain(TOOLS_FIXTURE_TOOL);
  });

  it("prints the tool's input schema", async () => {
    const res = await runCli({ site: "tools", args: ["tool", TOOLS_FIXTURE_TOOL, "--schema"] });
    expect(res.code, res.stderr).toBe(0);
    const out = parseJson<{ name: string; inputSchema: { type: string } }>(res.stdout);
    expect(out.name).toBe(TOOLS_FIXTURE_TOOL);
    expect(out.inputSchema.type).toBe("object");
  });

  it("calls the tool and creates the node (AC-2)", async () => {
    const title = `it-tool-${crypto.randomUUID()}`;
    const data = { entity_type_id: "node", bundle: "article_test", base_fields: { title } };
    const res = await runCli({
      site: "tools",
      args: ["tool", TOOLS_FIXTURE_TOOL, `--data=${JSON.stringify(data)}`],
    });
    expect(res.code, res.stderr).toBe(0);
    expect(await searchByTitle(title)).toHaveLength(1);
  });

  it("sets a nullable object input via --param", async () => {
    const title = `it-tool-param-${crypto.randomUUID()}`;
    const res = await runCli({
      site: "tools",
      args: [
        "tool",
        TOOLS_FIXTURE_TOOL,
        "--param=entity_type_id=node",
        "--param=bundle=article_test",
        `--param=base_fields=${JSON.stringify({ title })}`,
      ],
    });
    expect(res.code, res.stderr).toBe(0);
    expect(await searchByTitle(title)).toHaveLength(1);
  });

  it("rejects arguments that violate the input schema before sending (AC-2)", async () => {
    const title = `it-tool-invalid-${crypto.randomUUID()}`;
    const res = await runCli({
      site: "tools",
      args: ["tool", TOOLS_FIXTURE_TOOL, `--data=${JSON.stringify({ base_fields: { title } })}`],
    });
    expect(res.code).toBe(4);
    expect(parseError(res.stderr).error.code).toBe("E_VALIDATION");
    expect(await searchByTitle(title)).toHaveLength(0);
  });

  it("exits 1 with the tool's message when the server rejects valid input (AC-3)", async () => {
    const data = {
      entity_type_id: "node",
      bundle: "article_test",
      base_fields: { title: "x", no_such_field: "y" },
    };
    const res = await runCli({
      site: "tools",
      args: ["tool", TOOLS_FIXTURE_TOOL, `--data=${JSON.stringify(data)}`],
    });
    expect(res.code).toBe(1);
    const err = parseError(res.stderr).error;
    expect(err.code).toBe("E_TOOL");
    expect(err.message.length).toBeGreaterThan(0);
  });

  it("rejects basic auth on /mcp, naming mcp_server_oauth (AC-4)", async () => {
    const res = await runCli({ site: "tools", auth: basicAuth("tools"), args: ["tool"] });
    expect(res.code).toBe(3);
    expect(parseError(res.stderr).error.message).toContain("mcp_server_oauth");
  });

  it("names the endpoint on a site without mcp_server (AC-4)", async () => {
    const res = await runCli({ site: "plain", extraPlugins: ["tool"], args: ["tool"] });
    expect(res.code).toBe(5);
    expect(parseError(res.stderr).error.message).toContain("is mcp_server enabled?");
  });
});
