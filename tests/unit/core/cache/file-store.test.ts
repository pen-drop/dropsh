import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileStore } from "../../../../src/core/cache/file-store.js";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "dropsh-cache-"));
}

describe("createFileStore", () => {
  it("writes atomically and reads the value back", async () => {
    const dir = freshDir();
    const warnings: string[] = [];
    const store = createFileStore({ rootDir: dir, warn: (m) => warnings.push(m) });
    await store.write("catalog.json", { hello: "world" });
    const v = await store.read<{ hello: string }>("catalog.json");
    expect(v).toEqual({ hello: "world" });
    expect(warnings).toEqual([]);
  });

  it("returns undefined on read miss", async () => {
    const dir = freshDir();
    const store = createFileStore({ rootDir: dir, warn: () => {} });
    expect(await store.read("missing.json")).toBeUndefined();
  });

  it("treats corrupt JSON as a miss and warns", async () => {
    const dir = freshDir();
    writeFileSync(join(dir, "bad.json"), "{not json");
    const warnings: string[] = [];
    const store = createFileStore({ rootDir: dir, warn: (m) => warnings.push(m) });
    expect(await store.read("bad.json")).toBeUndefined();
    expect(warnings.some((w) => w.includes("unreadable"))).toBe(true);
  });

  it("creates intermediate directories on write", async () => {
    const dir = freshDir();
    const store = createFileStore({ rootDir: dir, warn: () => {} });
    await store.write("schema/node--article.create.json", { a: 1 });
    const on_disk = JSON.parse(readFileSync(join(dir, "schema/node--article.create.json"), "utf8"));
    expect(on_disk).toEqual({ a: 1 });
  });

  // root ignores chmod restrictions, so this test is meaningless in root-based CI containers
  it.skipIf(process.getuid?.() === 0)(
    "does not throw when write fails; emits warning instead",
    async () => {
      const dir = freshDir();
      chmodSync(dir, 0o500); // read+execute, no write
      const warnings: string[] = [];
      const store = createFileStore({ rootDir: dir, warn: (m) => warnings.push(m) });
      await store.write("blocked.json", { a: 1 });
      expect(warnings.some((w) => w.includes("could not update cache"))).toBe(true);
      chmodSync(dir, 0o700); // restore for cleanup
    },
  );
});
