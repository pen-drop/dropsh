import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HttpClient } from "dropsh/plugin";
import { AuthError } from "dropsh/plugin";
import { describe, expect, it } from "vitest";
import { generatePkce, generateState, runLogin } from "../../src/login.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Navigate up to repo root: plugins/oauth2/tests/unit → repo root is ../../../../
const fixture = (name: string): string =>
  path.join(here, "..", "..", "..", "..", "tests", "unit", "fixtures", "config", name);
const PORT = 7432;

function httpMock(body: unknown): HttpClient {
  return {
    async send() {
      return { status: 200, headers: {}, body: JSON.stringify(body) };
    },
  };
}

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));
  await fn(dir);
}

function makeOpenBrowser(state: string, code: string): (url: string) => Promise<void> {
  return async () => {
    await fetch(
      `http://localhost:${PORT}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    );
  };
}

describe("generatePkce", () => {
  it("produces a valid SHA-256 PKCE challenge", () => {
    const { verifier, challenge } = generatePkce();
    expect(verifier.length).toBeGreaterThan(0);
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
  });

  it("uses base64url encoding (no +, /, = characters)", () => {
    for (let i = 0; i < 20; i++) {
      const { verifier, challenge } = generatePkce();
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("produces unique verifiers each call", () => {
    const a = generatePkce();
    const b = generatePkce();
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe("generateState", () => {
  it("returns a non-empty base64url string", () => {
    const s = generateState();
    expect(typeof s).toBe("string");
    expect(s.length).toBeGreaterThan(0);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces unique values each call", () => {
    expect(generateState()).not.toBe(generateState());
  });
});

describe("runLogin", () => {
  it("completes full flow, writes token, and prints success", async () => {
    await withTmpDir(async (dir) => {
      const knownState = "known-state";
      const knownCode = "auth-code-xyz";
      const logs: string[] = [];

      await runLogin({
        configPath: fixture("basic-noenv.js"),
        clientId: "tests-authcode",
        tokenUrl: "https://example.com/oauth/token",
        http: httpMock({ access_token: "tok123", refresh_token: "ref456", expires_in: 3600 }),
        openBrowser: makeOpenBrowser(knownState, knownCode),
        _generateState: () => knownState,
        tokenDir: dir,
        stdout: (s) => logs.push(s),
        now: () => 0,
      });

      const raw = await readFile(join(dir, "example.com.json"), "utf8");
      const stored = JSON.parse(raw);
      expect(stored.access_token).toBe("tok123");
      expect(stored.refresh_token).toBe("ref456");
      expect(logs.some((l) => l.includes("Logged in"))).toBe(true);
    });
  });

  it("throws AuthError when received state does not match", async () => {
    await withTmpDir(async (dir) => {
      await expect(
        runLogin({
          configPath: fixture("basic-noenv.js"),
          clientId: "tests-authcode",
          tokenUrl: "https://example.com/oauth/token",
          http: httpMock({ access_token: "tok" }),
          openBrowser: makeOpenBrowser("wrong-state", "some-code"),
          _generateState: () => "correct-state",
          tokenDir: dir,
          stdout: () => {},
          timeoutMs: 5000,
        }),
      ).rejects.toBeInstanceOf(AuthError);
    });
  });

  it("throws AuthError when browser flow times out", async () => {
    await withTmpDir(async (dir) => {
      await expect(
        runLogin({
          configPath: fixture("basic-noenv.js"),
          clientId: "tests-authcode",
          tokenUrl: "https://example.com/oauth/token",
          http: httpMock({}),
          openBrowser: async () => {},
          tokenDir: dir,
          stdout: () => {},
          timeoutMs: 100,
        }),
      ).rejects.toBeInstanceOf(AuthError);
    });
  });
});
