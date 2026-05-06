import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HttpClient } from "dropsh/plugin";
import { AuthError } from "dropsh/plugin";
import { describe, expect, it } from "vitest";
import { createOAuth2AuthCodeAuth } from "../../src/oauth2-authcode.js";
import { readToken, writeToken } from "../../src/token-store.js";

function httpMock(responses: Array<{ status: number; body: unknown }>): HttpClient {
  let i = 0;
  return {
    async send() {
      const r = responses[i++];
      if (!r) throw new Error("unexpected http call");
      if (r.status >= 200 && r.status < 300) {
        return { status: r.status, headers: {}, body: JSON.stringify(r.body) };
      }
      const { HttpError } = await import("../../../../src/errors.js");
      throw new HttpError(r.status, `HTTP ${r.status}`, r.body);
    },
  };
}

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "drupal-cli-test-"));
  await fn(dir);
}

// token_url must end with /oauth/token so storage key == BASE
const BASE = "https://example.com";
const TOKEN_URL = `${BASE}/oauth/token`;
const CFG = { type: "oauth2_authcode" as const, client_id: "my-client", token_url: TOKEN_URL };

describe("oauth2-authcode adapter", () => {
  it("attaches Bearer header when access token is still valid", async () => {
    await withTmpDir(async (dir) => {
      await writeToken(BASE, { access_token: "valid-tok", expires_at: 9_999_999_999_000 }, dir);
      const adapter = createOAuth2AuthCodeAuth(CFG, {
        http: httpMock([]),
        now: () => 0,
        tokenDir: dir,
      });
      const req = await adapter.apply({ method: "GET", url: "https://example.com/jsonapi" });
      expect(req.headers?.Authorization).toBe("Bearer valid-tok");
    });
  });

  it("makes no network call when token is valid", async () => {
    await withTmpDir(async (dir) => {
      await writeToken(BASE, { access_token: "tok", expires_at: 9_999_999_999_000 }, dir);
      let calls = 0;
      const http: HttpClient = {
        async send() {
          calls++;
          return { status: 200, headers: {}, body: "{}" };
        },
      };
      const adapter = createOAuth2AuthCodeAuth(CFG, { http, now: () => 0, tokenDir: dir });
      await adapter.apply({ method: "GET", url: "https://example.com" });
      expect(calls).toBe(0);
    });
  });

  it("silently refreshes when access token is expired", async () => {
    await withTmpDir(async (dir) => {
      const http = httpMock([
        {
          status: 200,
          body: { access_token: "new-tok", refresh_token: "new-ref", expires_in: 3600 },
        },
      ]);
      await writeToken(
        BASE,
        { access_token: "old-tok", refresh_token: "old-ref", expires_at: 1000 },
        dir,
      );
      const adapter = createOAuth2AuthCodeAuth(CFG, { http, now: () => 2_000_000, tokenDir: dir });
      const req = await adapter.apply({ method: "GET", url: "https://example.com/jsonapi" });
      expect(req.headers?.Authorization).toBe("Bearer new-tok");
    });
  });

  it("writes the refreshed token back to disk", async () => {
    await withTmpDir(async (dir) => {
      const http = httpMock([
        {
          status: 200,
          body: { access_token: "new-tok", refresh_token: "new-ref", expires_in: 3600 },
        },
      ]);
      await writeToken(
        BASE,
        { access_token: "old-tok", refresh_token: "old-ref", expires_at: 1000 },
        dir,
      );
      const adapter = createOAuth2AuthCodeAuth(CFG, { http, now: () => 2_000_000, tokenDir: dir });
      await adapter.apply({ method: "GET", url: "https://example.com" });
      const stored = await readToken(BASE, dir);
      expect(stored?.access_token).toBe("new-tok");
      expect(stored?.refresh_token).toBe("new-ref");
    });
  });

  it("uses old refresh_token when server does not return a new one", async () => {
    await withTmpDir(async (dir) => {
      const http = httpMock([{ status: 200, body: { access_token: "new-tok", expires_in: 3600 } }]);
      await writeToken(
        BASE,
        { access_token: "old-tok", refresh_token: "keep-ref", expires_at: 1000 },
        dir,
      );
      const adapter = createOAuth2AuthCodeAuth(CFG, { http, now: () => 2_000_000, tokenDir: dir });
      await adapter.apply({ method: "GET", url: "https://example.com" });
      const stored = await readToken(BASE, dir);
      expect(stored?.refresh_token).toBe("keep-ref");
    });
  });

  it("throws AuthError when access token expired and no refresh_token stored", async () => {
    await withTmpDir(async (dir) => {
      await writeToken(BASE, { access_token: "old-tok", expires_at: 1000 }, dir);
      const adapter = createOAuth2AuthCodeAuth(CFG, {
        http: httpMock([]),
        now: () => 2_000_000,
        tokenDir: dir,
      });
      await expect(
        adapter.apply({ method: "GET", url: "https://example.com" }),
      ).rejects.toBeInstanceOf(AuthError);
    });
  });

  it("throws AuthError when refresh request returns HTTP error", async () => {
    await withTmpDir(async (dir) => {
      const http = httpMock([{ status: 401, body: { error: "invalid_token" } }]);
      await writeToken(BASE, { access_token: "old", refresh_token: "ref", expires_at: 1000 }, dir);
      const adapter = createOAuth2AuthCodeAuth(CFG, { http, now: () => 2_000_000, tokenDir: dir });
      await expect(
        adapter.apply({ method: "GET", url: "https://example.com" }),
      ).rejects.toBeInstanceOf(AuthError);
    });
  });

  it("throws AuthError when no token file exists", async () => {
    await withTmpDir(async (dir) => {
      const adapter = createOAuth2AuthCodeAuth(CFG, { http: httpMock([]), tokenDir: dir });
      await expect(
        adapter.apply({ method: "GET", url: "https://example.com" }),
      ).rejects.toBeInstanceOf(AuthError);
    });
  });
});
