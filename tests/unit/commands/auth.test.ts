import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runAuthLogin, runAuthLogout, runAuthStatus, runAuthUse } from "../../../src/commands/auth.js";
import { readProfile, readProfiles, readSession } from "../../../src/core/auth/session-store.js";
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

  it("non-TTY with a single provider and no --provider uses that provider", async () => {
    const stateDir = await tmp();
    await runAuthLogin({}, { ...deps({ stateDir, isTTY: false, providers: [provider("only")] }) });
    const rec = await readSession("https://example.com", stateDir);
    expect(rec?.activeProvider).toBe("only");
  });

  it("interactive picker selects by number", async () => {
    const stateDir = await tmp();
    await runAuthLogin({}, { ...deps({ stateDir, prompt: vi.fn(async () => "2") }) });
    const rec = await readSession("https://example.com", stateDir);
    expect(rec?.activeProvider).toBe("b");
  });

  it("uses the sole provider directly without prompting", async () => {
    const stateDir = await tmp();
    const stdout = vi.fn();
    const prompt = vi.fn(async () => "1");
    await runAuthLogin({}, { ...deps({ stateDir, stdout, prompt, providers: [provider("only")] }) });
    expect(stdout.mock.calls.flat().join("")).not.toContain("Select an auth provider");
    expect(prompt).not.toHaveBeenCalled();
    const rec = await readSession("https://example.com", stateDir);
    expect(rec?.activeProvider).toBe("only");
  });

  it("falls back to the default:true provider without prompting", async () => {
    const stateDir = await tmp();
    const prompt = vi.fn(async () => "1");
    const withDefault = provider("b");
    withDefault.default = true;
    await runAuthLogin(
      {},
      { ...deps({ stateDir, prompt, providers: [provider("a"), withDefault] }) },
    );
    expect(prompt).not.toHaveBeenCalled();
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

describe("auth multi-profile commands", () => {
  it("login writes a named profile and makes it active", async () => {
    const stateDir = await tmp();
    await runAuthLogin({ provider: "a" }, { ...deps({ stateDir }) });
    await runAuthLogin({ provider: "b" }, { ...deps({ stateDir }) });
    const file = await readProfiles("https://example.com", stateDir);
    expect(Object.keys(file?.profiles ?? {}).sort()).toEqual(["a", "b"]);
    expect(file?.active).toBe("b"); // last login is active
    // First profile's session survived the second login.
    expect(await readProfile("https://example.com", "a", stateDir)).not.toBeNull();
  });

  it("use switches the active profile without re-login", async () => {
    const stateDir = await tmp();
    await runAuthLogin({ provider: "a" }, { ...deps({ stateDir }) });
    await runAuthLogin({ provider: "b" }, { ...deps({ stateDir }) });
    await runAuthUse({ profile: "a" }, { ...deps({ stateDir }) });
    expect((await readProfiles("https://example.com", stateDir))?.active).toBe("a");
  });

  it("use errors for an unknown profile", async () => {
    const stateDir = await tmp();
    await expect(runAuthUse({ profile: "ghost" }, { ...deps({ stateDir }) })).rejects.toThrow(
      /no auth profile 'ghost'/,
    );
  });

  it("logout --profile clears one slot and leaves the other", async () => {
    const stateDir = await tmp();
    await runAuthLogin({ provider: "a" }, { ...deps({ stateDir }) });
    await runAuthLogin({ provider: "b" }, { ...deps({ stateDir }) });
    await runAuthLogout({ profile: "a" }, { ...deps({ stateDir }) });
    const file = await readProfiles("https://example.com", stateDir);
    expect(Object.keys(file?.profiles ?? {})).toEqual(["b"]);
  });

  it("logout --all clears every profile", async () => {
    const stateDir = await tmp();
    await runAuthLogin({ provider: "a" }, { ...deps({ stateDir }) });
    await runAuthLogin({ provider: "b" }, { ...deps({ stateDir }) });
    await runAuthLogout({ all: true }, { ...deps({ stateDir }) });
    expect(await readProfiles("https://example.com", stateDir)).toBeNull();
  });

  it("status lists all profiles with an active marker", async () => {
    const stateDir = await tmp();
    const stdout = vi.fn();
    await runAuthLogin({ provider: "a" }, { ...deps({ stateDir }) });
    await runAuthLogin({ provider: "b" }, { ...deps({ stateDir }) });
    await runAuthUse({ profile: "a" }, { ...deps({ stateDir }) });
    await runAuthStatus({}, { ...deps({ stateDir, stdout }) });
    const out = stdout.mock.calls.flat().join("");
    expect(out).toContain("* a:");
    expect(out).toContain("  b:");
  });

  it("status --json emits a keyed map with the active pointer", async () => {
    const stateDir = await tmp();
    const stdout = vi.fn();
    await runAuthLogin({ provider: "a" }, { ...deps({ stateDir }) });
    await runAuthStatus({ json: true }, { ...deps({ stateDir, stdout }) });
    const parsed = JSON.parse(stdout.mock.calls.flat().join(""));
    expect(parsed.active).toBe("a");
    expect(parsed.profiles.a.loggedIn).toBe(true);
  });
});
