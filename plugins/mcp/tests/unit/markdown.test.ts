import { chmod, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ConfigError } from "dropsh/plugin";
import { afterEach, describe, expect, it } from "vitest";
import { loadMarkdown } from "../../src/markdown.js";
import { parseMcpOptions } from "../../src/options.js";
import { createMcpServer, promptResourceUri } from "../../src/server.js";

const markdownText = "# Create a ticket\n\nUse this skill.";
const dirs: string[] = [];

afterEach(async () => {
  // Leave temp dirs for the OS; nothing to close.
  dirs.length = 0;
});

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dropsh-mcp-md-"));
  dirs.push(dir);
  return dir;
}

describe("loadMarkdown", () => {
  it("returns an empty map when no directory is configured", async () => {
    expect(await loadMarkdown()).toEqual(new Map());
    expect(await loadMarkdown(undefined)).toEqual(new Map());
  });

  it("loads direct regular .md files by stem, sorted, and ignores the rest", async () => {
    const dir = await fixture();
    const outsideDir = await fixture();
    const outside = join(outsideDir, "outside-target.md");
    await writeFile(outside, "SECRET", "utf8");
    await writeFile(join(dir, "zeta.md"), "Z", "utf8");
    await writeFile(join(dir, "create-ticket.md"), markdownText, "utf8");
    await writeFile(join(dir, "notes.txt"), "nope", "utf8");
    await mkdir(join(dir, "nested"));
    await writeFile(join(dir, "nested", "hidden.md"), "nested", "utf8");
    await symlink(outside, join(dir, "outside.md"));

    const files = await loadMarkdown(dir);
    expect([...files.keys()]).toEqual(["create-ticket", "zeta"]);
    expect(files.get("create-ticket")).toBe(markdownText);
    expect(files.has("outside")).toBe(false);
    expect(files.has("hidden")).toBe(false);
    expect(files.has("notes")).toBe(false);
  });

  it("fails startup when the directory is missing or unreadable", async () => {
    await expect(loadMarkdown(join(tmpdir(), "dropsh-mcp-missing-dir"))).rejects.toThrow(
      ConfigError,
    );
    const dir = await fixture();
    await chmod(dir, 0o000);
    try {
      await expect(loadMarkdown(dir)).rejects.toThrow(ConfigError);
    } finally {
      await chmod(dir, 0o700);
    }
  });
});

describe("markdown prompts and resources", () => {
  it("exposes exact text as a prompt and encoded resource, and rejects unknown/traversal URIs", async () => {
    const snapshot = new Map([["create-ticket", markdownText]]);
    const server = createMcpServer(
      parseMcpOptions({ bundles: ["node/article"], operations: ["read"] }),
      async () => {
        throw new Error("backend unused");
      },
      snapshot,
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "md-test", version: "0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toEqual(["create-ticket"]);
    const prompt = await client.getPrompt({ name: "create-ticket" });
    expect(prompt.messages[0]?.content).toEqual({ type: "text", text: markdownText });

    const resources = await client.listResources();
    expect(resources.resources[0]?.uri).toBe(promptResourceUri("create-ticket"));
    const read = await client.readResource({ uri: promptResourceUri("create-ticket") });
    expect(read.contents[0]).toMatchObject({ mimeType: "text/markdown", text: markdownText });

    await expect(client.getPrompt({ name: "missing" })).rejects.toThrow(/unknown prompt/);
    await expect(client.readResource({ uri: "dropsh://prompts/missing" })).rejects.toThrow(
      /unknown resource/,
    );
    await expect(client.readResource({ uri: "dropsh://prompts/../create-ticket" })).rejects.toThrow(
      /unknown resource/,
    );
    await expect(client.readResource({ uri: "file:///etc/passwd" })).rejects.toThrow(
      /unknown resource/,
    );
  });
});
