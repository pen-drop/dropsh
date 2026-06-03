import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createPrompt } from "../../../../src/core/cli/prompt.js";

describe("createPrompt", () => {
  it("reads a line of input and strips the newline", async () => {
    const input = new PassThrough();
    const out: string[] = [];
    const prompt = createPrompt({ input, write: (s) => out.push(s) });
    const p = prompt({ label: "Username" });
    input.write("admin\n");
    expect(await p).toBe("admin");
    expect(out.join("")).toContain("Username");
  });

  it("does not echo the label suffix differently for secrets but still resolves", async () => {
    const input = new PassThrough();
    const prompt = createPrompt({ input, write: () => {} });
    const p = prompt({ label: "Password", secret: true });
    input.write("hunter2\n");
    expect(await p).toBe("hunter2");
  });
});
