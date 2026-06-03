import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clearSession, readSession, writeSession } from "../../../../src/core/auth/session-store.js";

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));
  await fn(dir);
}

describe("session-store", () => {
  it("returns null when no session file exists", async () => {
    await withTmpDir(async (dir) => {
      expect(await readSession("https://example.com", dir)).toBeNull();
    });
  });

  it("round-trips a written session", async () => {
    await withTmpDir(async (dir) => {
      await writeSession("https://example.com", "oauth2_authcode", { access_token: "a", expires_at: 9 }, dir);
      const rec = await readSession("https://example.com", dir);
      expect(rec).toEqual({ activeProvider: "oauth2_authcode", session: { access_token: "a", expires_at: 9 } });
    });
  });

  it("writes the session file with 0600 permissions", async () => {
    await withTmpDir(async (dir) => {
      await writeSession("https://example.com", "basic", { basic_b64: "x" }, dir);
      const info = await stat(join(dir, "example.com.json"));
      expect(info.mode & 0o777).toBe(0o600);
    });
  });

  it("uses hostname as filename, ignoring path and port", async () => {
    await withTmpDir(async (dir) => {
      await writeSession("https://my.site.org:8080/x", "basic", { basic_b64: "y" }, dir);
      const rec = await readSession("https://my.site.org:9999/other", dir);
      expect(rec?.session).toEqual({ basic_b64: "y" });
    });
  });

  it("clearSession removes the active session", async () => {
    await withTmpDir(async (dir) => {
      await writeSession("https://example.com", "basic", { basic_b64: "x" }, dir);
      await clearSession("https://example.com", dir);
      expect(await readSession("https://example.com", dir)).toBeNull();
    });
  });

  it("clearSession on a missing session is a no-op", async () => {
    await withTmpDir(async (dir) => {
      await clearSession("https://example.com", dir);
      expect(await readSession("https://example.com", dir)).toBeNull();
    });
  });
});
