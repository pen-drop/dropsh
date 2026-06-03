import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runAuthLogin, runAuthLogout, runAuthStatus } from "../../../src/commands/auth.js";
import { readSession } from "../../../src/core/auth/session-store.js";
import type { AuthProvider } from "../../../src/core/auth/types.js";

function provider(id: string, login = true): AuthProvider {
  return {
    id,
    displayName: id,
    capabilities: { login, logout: true, status: true },
    async login() { return { access_token: "tok", expires_at: 10 }; },
    async logout() {},
    async status(s) { return { loggedIn: s !== null, provider: id }; },
    createAdapter() { return { async apply(r) { return r; } }; },
  };
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "dropsh-test-"));
}

function deps(over: Record<string, unknown> = {}) {
  return {
    baseUrl: "https://example.com",
    providers: [provider("a"), provider("b")],
    stdout: vi.fn(),
    stderr: vi.fn(),
    prompt: vi.fn(async () => "1"),
    openBrowser: vi.fn(async () => {}),
    http: { async send() { throw new Error("unused"); } },
    now: () => 0,
    isTTY: true,
    ...over,
  };
}

describe("auth login", () => {
  it("with --provider writes the chosen provider's session", async () => {
    const stateDir = await tmp();
    await runAuthLogin({ provider: "b" }, { ...deps({ stateDir }) });
    const rec = await readSession("https://example.com", stateDir);
    expect(rec?.activeProvider).toBe("b");
    expect(rec?.session.access_token).toBe("tok");
  });

  it("with an unknown --provider errors and writes nothing", async () => {
    const stateDir = await tmp();
    const stderr = vi.fn();
    await expect(runAuthLogin({ provider: "zzz" }, { ...deps({ stateDir, stderr }) })).rejects.toThrow(/zzz/);
    expect(await readSession("https://example.com", stateDir)).toBeNull();
  });

  it("non-TTY without --provider errors", async () => {
    const stateDir = await tmp();
    await expect(runAuthLogin({}, { ...deps({ stateDir, isTTY: false }) })).rejects.toThrow(/non-interactive/);
  });

  it("non-TTY with a single provider and no --provider errors", async () => {
    const stateDir = await tmp();
    await expect(
      runAuthLogin({}, { ...deps({ stateDir, isTTY: false, providers: [provider("only")] }) }),
    ).rejects.toThrow(/non-interactive/);
  });

  it("interactive picker selects by number", async () => {
    const stateDir = await tmp();
    await runAuthLogin({}, { ...deps({ stateDir, prompt: vi.fn(async () => "2") }) });
    const rec = await readSession("https://example.com", stateDir);
    expect(rec?.activeProvider).toBe("b");
  });
});

describe("auth logout / status", () => {
  it("logout clears the session", async () => {
    const stateDir = await tmp();
    await runAuthLogin({ provider: "a" }, { ...deps({ stateDir }) });
    await runAuthLogout({}, { ...deps({ stateDir }) });
    expect(await readSession("https://example.com", stateDir)).toBeNull();
  });

  it("status with no session reports not logged in", async () => {
    const stateDir = await tmp();
    const stdout = vi.fn();
    await runAuthStatus({}, { ...deps({ stateDir, stdout }) });
    expect(stdout.mock.calls.flat().join("")).toContain("not logged in");
  });
});
