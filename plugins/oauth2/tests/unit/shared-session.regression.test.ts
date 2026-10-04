// Regression: several processes share one persisted session slot, and the server
// rotates the refresh token on every refresh. An adapter holding a session it read
// at startup must not refresh with a token another process already rotated away.

import { type AuthSession, type HttpClient, HttpError, type HttpRequest } from "dropsh/plugin";
import { describe, expect, it } from "vitest";
import { oauth2Plugin } from "../../src/index.js";

const NOW = 1_000_000;
const req: HttpRequest = { method: "GET", url: "/x", headers: {} };

/** Token endpoint with refresh-token rotation: each refresh token works once. */
function rotatingServer() {
  let gen = 0;
  const valid = new Set(["rt0"]);
  let calls = 0;
  const http: HttpClient = {
    async send(r) {
      calls++;
      const rt = new URLSearchParams(String(r.body)).get("refresh_token") ?? "";
      if (!valid.delete(rt)) throw new HttpError(400, "HTTP 400", { error: "invalid_grant" });
      gen++;
      valid.add(`rt${gen}`);
      const body = { access_token: `at${gen}`, refresh_token: `rt${gen}`, expires_in: 3600 };
      return { status: 200, headers: {}, body: JSON.stringify(body) };
    },
  };
  return { http, calls: () => calls };
}

function sharedStore(initial: AuthSession) {
  let slot = initial;
  return {
    save: async (s: AuthSession) => {
      slot = s;
    },
    load: async () => slot,
  };
}

const provider = () =>
  oauth2Plugin({
    type: "oauth2_device_code",
    client_id: "gaia-cli",
    device_authorization_url: "https://example.org/oauth/device_authorization",
    token_url: "https://example.org/oauth/token",
  }).authProvider!;

const expired = { access_token: "at0", refresh_token: "rt0", expires_at: 1 };

describe("shared session slot across processes", () => {
  it("a second process adopts the token the first one stored instead of refreshing", async () => {
    const server = rotatingServer();
    const store = sharedStore(expired);
    const a = provider().createAdapter(expired, { http: server.http, now: () => NOW, ...store });
    const b = provider().createAdapter(expired, { http: server.http, now: () => NOW, ...store });

    expect((await a.apply(req)).headers?.Authorization).toBe("Bearer at1");
    expect((await b.apply(req)).headers?.Authorization).toBe("Bearer at1");
    expect(server.calls()).toBe(1);
  });

  it("losing the refresh race adopts the winner's token instead of failing", async () => {
    const server = rotatingServer();
    const store = sharedStore(expired);
    // b loads the slot before a has saved, so b still posts the rotated-away rt0.
    let first = true;
    const racyLoad = async () => {
      if (first) {
        first = false;
        return expired;
      }
      return store.load();
    };
    const a = provider().createAdapter(expired, { http: server.http, now: () => NOW, ...store });
    const b = provider().createAdapter(expired, {
      http: server.http,
      now: () => NOW,
      save: store.save,
      load: racyLoad,
    });

    await a.apply(req);
    expect((await b.apply(req)).headers?.Authorization).toBe("Bearer at1");
  });

  it("without a newer stored token the rejection still surfaces", async () => {
    const server = rotatingServer();
    const stale = { access_token: "atX", refresh_token: "revoked", expires_at: 1 };
    const store = sharedStore(stale);
    const a = provider().createAdapter(stale, { http: server.http, now: () => NOW, ...store });

    await expect(a.apply(req)).rejects.toThrow(/credentials_rejected/);
  });
});
