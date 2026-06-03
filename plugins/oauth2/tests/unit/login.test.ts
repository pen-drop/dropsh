import { createHash } from "node:crypto";
import type { HttpClient } from "dropsh/plugin";
import { AuthError } from "dropsh/plugin";
import { describe, expect, it } from "vitest";
import { acquireAuthCodeSession, generatePkce, generateState } from "../../src/login.js";

function tokenHttp(body: unknown): HttpClient {
  return {
    async send() {
      return { status: 200, headers: {}, body: JSON.stringify(body) };
    },
  };
}

/**
 * Drives the local callback server deterministically: instead of opening a
 * browser, performs an HTTP GET to the callback URL with the known state so
 * the server resolves the auth code.
 */
function callbackDriver(port: number, state: string, code: string): (url: string) => Promise<void> {
  return async () => {
    await fetch(
      `http://localhost:${port}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
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

describe("acquireAuthCodeSession", () => {
  it("runs the browser callback flow and returns a session", { timeout: 20_000 }, async () => {
    const port = 28473;
    const knownState = "known-state";
    const knownCode = "auth-code-xyz";

    const session = await acquireAuthCodeSession({
      baseUrl: "https://example.com",
      clientId: "tests-authcode",
      tokenUrl: "https://example.com/oauth/token",
      redirectPort: port,
      http: tokenHttp({ access_token: "tok123", refresh_token: "ref456", expires_in: 3600 }),
      openBrowser: callbackDriver(port, knownState, knownCode),
      stdout: () => {},
      now: () => 0,
      _generatePkce: () => ({ verifier: "v", challenge: "c" }),
      _generateState: () => knownState,
    });

    expect(session.access_token).toBe("tok123");
    expect(session.refresh_token).toBe("ref456");
    expect(session.expires_at).toBe(3600 * 1000 - 5000);
  });

  it("throws AuthError when the returned state does not match", { timeout: 20_000 }, async () => {
    const port = 28474;

    await expect(
      acquireAuthCodeSession({
        baseUrl: "https://example.com",
        clientId: "tests-authcode",
        tokenUrl: "https://example.com/oauth/token",
        redirectPort: port,
        http: tokenHttp({ access_token: "tok" }),
        openBrowser: callbackDriver(port, "wrong-state", "some-code"),
        stdout: () => {},
        now: () => 0,
        timeoutMs: 5000,
        _generateState: () => "correct-state",
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("throws AuthError when the browser flow times out", { timeout: 20_000 }, async () => {
    const port = 28475;

    await expect(
      acquireAuthCodeSession({
        baseUrl: "https://example.com",
        clientId: "tests-authcode",
        tokenUrl: "https://example.com/oauth/token",
        redirectPort: port,
        http: tokenHttp({}),
        openBrowser: async () => {},
        stdout: () => {},
        now: () => 0,
        timeoutMs: 100,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
