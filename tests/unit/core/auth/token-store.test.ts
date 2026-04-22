import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readToken, type StoredToken, writeToken } from "../../../../src/core/auth/token-store.js";

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "drupal-cli-test-"));
  await fn(dir);
}

describe("token-store", () => {
  it("returns null when token file does not exist", async () => {
    await withTmpDir(async (dir) => {
      const result = await readToken("https://example.com", dir);
      expect(result).toBeNull();
    });
  });

  it("reads a written token back correctly", async () => {
    await withTmpDir(async (dir) => {
      const token: StoredToken = { access_token: "tok1", refresh_token: "ref1", expires_at: 9999 };
      await writeToken("https://example.com", token, dir);
      const result = await readToken("https://example.com", dir);
      expect(result).toEqual(token);
    });
  });

  it("writes token file with 0600 permissions", async () => {
    await withTmpDir(async (dir) => {
      const token: StoredToken = { access_token: "tok", expires_at: 1234 };
      await writeToken("https://example.com", token, dir);
      const info = await stat(join(dir, "example.com.json"));
      expect(info.mode & 0o777).toBe(0o600);
    });
  });

  it("creates the token directory if it does not exist", async () => {
    await withTmpDir(async (dir) => {
      const nested = join(dir, "sub", "drupal-cli");
      const token: StoredToken = { access_token: "tok", expires_at: 1234 };
      await writeToken("https://example.com", token, nested);
      const result = await readToken("https://example.com", nested);
      expect(result?.access_token).toBe("tok");
    });
  });

  it("uses hostname as filename, ignoring path and port", async () => {
    await withTmpDir(async (dir) => {
      const token: StoredToken = { access_token: "x", expires_at: 0 };
      await writeToken("https://my.site.example.org:8080/some/path", token, dir);
      const raw = await readFile(join(dir, "my.site.example.org.json"), "utf8");
      expect(JSON.parse(raw).access_token).toBe("x");
    });
  });
});
