import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearAll,
  clearProfile,
  clearSession,
  readProfile,
  readProfiles,
  readSession,
  setActive,
  writeProfile,
  writeSession,
} from "../../../../src/core/auth/session-store.js";

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

  it("re-tightens permissions to 0600 when overwriting a loosened file", async () => {
    await withTmpDir(async (dir) => {
      await writeSession("https://example.com", "basic", { basic_b64: "x" }, dir);
      const path = join(dir, "example.com.json");
      await chmod(path, 0o644);
      await writeSession("https://example.com", "basic", { basic_b64: "y" }, dir);
      const info = await stat(path);
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

describe("session-store — multi-profile (v2)", () => {
  const url = "https://example.com";

  it("holds multiple profiles simultaneously in one file", async () => {
    await withTmpDir(async (dir) => {
      await writeProfile(url, "session", "oauth2_client_credentials", { access_token: "s" }, dir);
      await writeProfile(url, "pm", "oauth2_client_credentials", { access_token: "p" }, dir);
      const file = await readProfiles(url, dir);
      expect(Object.keys(file?.profiles ?? {}).sort()).toEqual(["pm", "session"]);
      expect((await readProfile(url, "session", dir))?.session.access_token).toBe("s");
      expect((await readProfile(url, "pm", dir))?.session.access_token).toBe("p");
    });
  });

  it("writeProfile merges without flattening sibling slots or the active pointer", async () => {
    await withTmpDir(async (dir) => {
      await writeProfile(url, "session", "cc", { access_token: "s1" }, dir);
      await setActive(url, "session", dir);
      await writeProfile(url, "pm", "cc", { access_token: "p1" }, dir);
      // Renew only the pm slot.
      await writeProfile(url, "pm", "cc", { access_token: "p2" }, dir);
      const file = await readProfiles(url, dir);
      expect(file?.active).toBe("session");
      expect(file?.profiles.session?.session.access_token).toBe("s1");
      expect(file?.profiles.pm?.session.access_token).toBe("p2");
    });
  });

  it("setActive errors when the slot has no stored session", async () => {
    await withTmpDir(async (dir) => {
      await expect(setActive(url, "ghost", dir)).rejects.toThrow(/no auth profile 'ghost'/);
    });
  });

  it("writeProfile keeps 0600 permissions", async () => {
    await withTmpDir(async (dir) => {
      await writeProfile(url, "session", "cc", { access_token: "s" }, dir);
      const info = await stat(join(dir, "example.com.json"));
      expect(info.mode & 0o777).toBe(0o600);
    });
  });

  it("clearProfile removes one slot and unsets active if it pointed there", async () => {
    await withTmpDir(async (dir) => {
      await writeProfile(url, "session", "cc", { access_token: "s" }, dir);
      await writeProfile(url, "pm", "cc", { access_token: "p" }, dir);
      await setActive(url, "pm", dir);
      await clearProfile(url, "pm", dir);
      const file = await readProfiles(url, dir);
      expect(Object.keys(file?.profiles ?? {})).toEqual(["session"]);
      expect(file?.active).toBeUndefined();
    });
  });

  it("clearProfile deletes the file when the last slot goes", async () => {
    await withTmpDir(async (dir) => {
      await writeProfile(url, "session", "cc", { access_token: "s" }, dir);
      await clearProfile(url, "session", dir);
      expect(await readProfiles(url, dir)).toBeNull();
    });
  });

  it("clearAll removes every profile", async () => {
    await withTmpDir(async (dir) => {
      await writeProfile(url, "session", "cc", { access_token: "s" }, dir);
      await writeProfile(url, "pm", "cc", { access_token: "p" }, dir);
      await clearAll(url, dir);
      expect(await readProfiles(url, dir)).toBeNull();
    });
  });

  it("migrates a legacy { activeProvider, session } file on read", async () => {
    await withTmpDir(async (dir) => {
      const legacy = { activeProvider: "oauth2_client_credentials", session: { access_token: "old" } };
      await writeFile(join(dir, "example.com.json"), JSON.stringify(legacy), "utf8");
      const file = await readProfiles(url, dir);
      expect(file?.active).toBe("oauth2_client_credentials");
      expect(file?.profiles.oauth2_client_credentials?.session.access_token).toBe("old");
      // Legacy readSession still works over the migrated view.
      expect((await readSession(url, dir))?.activeProvider).toBe("oauth2_client_credentials");
    });
  });

  it("persists v2 on the next write after a legacy read", async () => {
    await withTmpDir(async (dir) => {
      const legacy = { activeProvider: "session", session: { access_token: "old" } };
      await writeFile(join(dir, "example.com.json"), JSON.stringify(legacy), "utf8");
      await writeProfile(url, "pm", "cc", { access_token: "new" }, dir);
      const onDisk = JSON.parse(await readFile(join(dir, "example.com.json"), "utf8"));
      expect(onDisk.version).toBe(2);
      expect(Object.keys(onDisk.profiles).sort()).toEqual(["pm", "session"]);
    });
  });
});
