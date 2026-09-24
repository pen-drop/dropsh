import type { HttpClient, HttpRequest } from "dropsh/plugin";
import { AuthError, HttpError } from "dropsh/plugin";
import { describe, expect, it } from "vitest";
import { acquireDeviceSession } from "../../src/device.js";

/** A device authorization response with sane defaults, overridable per test. */
function deviceBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    device_code: "SECRET-DEVICE-CODE",
    user_code: "ABCD-EFGH",
    verification_uri: "https://example.org/activate",
    expires_in: 600,
    ...over,
  };
}

/**
 * A scripted HttpClient: the first request is the device authorization request,
 * every later one is a token poll answered from `replies` in order. Records every
 * request so a test can assert on the posted form body.
 */
function scriptedHttp(
  device: Record<string, unknown> | Error,
  replies: Array<Record<string, unknown> | Error>,
): HttpClient & { requests: HttpRequest[] } {
  const requests: HttpRequest[] = [];
  let poll = 0;
  return {
    requests,
    async send(req: HttpRequest) {
      requests.push(req);
      const reply = requests.length === 1 ? device : (replies[poll++] ?? replies.at(-1));
      if (reply instanceof Error) throw reply;
      return { status: 200, headers: {}, body: JSON.stringify(reply) };
    },
  };
}

/** Base deps: time is a counter, sleeping is recorded rather than performed. */
function baseDeps(http: HttpClient, out: string[], slept: number[]) {
  let clock = 1_000_000;
  return {
    clientId: "my-client",
    deviceAuthorizationUrl: "https://example.org/oauth/device_authorization",
    tokenUrl: "https://example.org/oauth/token",
    http,
    stdout: (s: string) => out.push(s),
    now: () => clock,
    _sleep: async (ms: number) => {
      slept.push(ms);
      clock += ms;
    },
  };
}

describe("acquireDeviceSession — device authorization request", () => {
  it("posts client_id and scope form-encoded and returns the session", async () => {
    const http = scriptedHttp(deviceBody(), [{ access_token: "tok", expires_in: 3600 }]);
    const out: string[] = [];
    const session = await acquireDeviceSession({
      ...baseDeps(http, out, []),
      scope: "content",
    });
    const first = http.requests.at(0);
    if (!first) throw new Error("no request recorded");
    expect(first.method).toBe("POST");
    expect(first.url).toBe("https://example.org/oauth/device_authorization");
    expect(first.headers?.["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(first.body as string);
    expect(form.get("client_id")).toBe("my-client");
    expect(form.get("scope")).toBe("content");
    expect(session.access_token).toBe("tok");
  });

  it("prints the verification URI and the user code in plain text", async () => {
    const http = scriptedHttp(deviceBody(), [{ access_token: "tok" }]);
    const out: string[] = [];
    await acquireDeviceSession(baseDeps(http, out, []));
    const printed = out.join("\n");
    expect(printed).toContain("https://example.org/activate");
    expect(printed).toContain("ABCD-EFGH");
  });

  it("prints verification_uri_complete when the server provides it", async () => {
    const http = scriptedHttp(
      deviceBody({ verification_uri_complete: "https://example.org/activate?user_code=ABCD-EFGH" }),
      [{ access_token: "tok" }],
    );
    const out: string[] = [];
    await acquireDeviceSession(baseDeps(http, out, []));
    expect(out.join("\n")).toContain("https://example.org/activate?user_code=ABCD-EFGH");
  });

  it("never prints the device_code or the access token", async () => {
    const http = scriptedHttp(deviceBody(), [{ access_token: "tok" }]);
    const out: string[] = [];
    await acquireDeviceSession(baseDeps(http, out, []));
    const printed = out.join("\n");
    expect(printed).not.toContain("SECRET-DEVICE-CODE");
    expect(printed).not.toContain("tok");
  });

  it("rejects a device response missing user_code without polling", async () => {
    const http = scriptedHttp(deviceBody({ user_code: undefined }), [{ access_token: "tok" }]);
    await expect(acquireDeviceSession(baseDeps(http, [], []))).rejects.toThrow(AuthError);
    expect(http.requests).toHaveLength(1);
  });

  it("rejects a device response whose expires_in is not a number", async () => {
    const http = scriptedHttp(deviceBody({ expires_in: "soon" }), [{ access_token: "tok" }]);
    await expect(acquireDeviceSession(baseDeps(http, [], []))).rejects.toThrow(AuthError);
  });

  it("names the endpoint but not the device_code when the request is rejected", async () => {
    const http = scriptedHttp(new HttpError(400, "Bad Request", { error: "invalid_client" }), []);
    const err = await acquireDeviceSession(baseDeps(http, [], [])).catch((e: Error) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as Error).message).toContain("https://example.org/oauth/device_authorization");
    expect((err as Error).message).not.toContain("SECRET-DEVICE-CODE");
  });
});

/** An HttpError carrying an RFC 6749 error code, as the token endpoint returns. */
function oauthError(code: string): HttpError {
  return new HttpError(400, "Bad Request", { error: code });
}

describe("acquireDeviceSession — polling", () => {
  it("waits the default 5 s before each poll when the server sends no interval", async () => {
    const http = scriptedHttp(deviceBody(), [
      oauthError("authorization_pending"),
      oauthError("authorization_pending"),
      { access_token: "tok" },
    ]);
    const slept: number[] = [];
    const session = await acquireDeviceSession(baseDeps(http, [], slept));
    expect(slept).toEqual([5000, 5000, 5000]);
    expect(session.access_token).toBe("tok");
  });

  it("honours the server's interval", async () => {
    const http = scriptedHttp(deviceBody({ interval: 2 }), [
      oauthError("authorization_pending"),
      { access_token: "tok" },
    ]);
    const slept: number[] = [];
    await acquireDeviceSession(baseDeps(http, [], slept));
    expect(slept).toEqual([2000, 2000]);
  });

  it("raises the interval permanently by 5 s on slow_down", async () => {
    const http = scriptedHttp(deviceBody({ interval: 2 }), [
      oauthError("slow_down"),
      oauthError("authorization_pending"),
      { access_token: "tok" },
    ]);
    const slept: number[] = [];
    await acquireDeviceSession(baseDeps(http, [], slept));
    expect(slept).toEqual([2000, 7000, 7000]);
  });

  it("posts the RFC 8628 grant, the device code and the client_id", async () => {
    const http = scriptedHttp(deviceBody(), [{ access_token: "tok" }]);
    await acquireDeviceSession(baseDeps(http, [], []));
    const second = http.requests.at(1);
    if (!second) throw new Error("no second request recorded");
    const form = new URLSearchParams(second.body as string);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
    expect(form.get("device_code")).toBe("SECRET-DEVICE-CODE");
    expect(form.get("client_id")).toBe("my-client");
    expect(form.get("client_secret")).toBeNull();
  });

  it.each([
    "access_denied",
    "expired_token",
    "invalid_client",
  ])("stops immediately on %s and never reports success", async (code) => {
    const http = scriptedHttp(deviceBody(), [oauthError(code)]);
    const err = await acquireDeviceSession(baseDeps(http, [], [])).catch((e: Error) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as Error).message).not.toContain("SECRET-DEVICE-CODE");
    // one device request + exactly one poll: no retry loop
    expect(http.requests).toHaveLength(2);
  });

  it("backs off but keeps polling on a transport failure without an OAuth code", async () => {
    const http = scriptedHttp(deviceBody(), [new Error("socket timeout"), { access_token: "tok" }]);
    const slept: number[] = [];
    await acquireDeviceSession(baseDeps(http, [], slept));
    expect(slept).toEqual([5000, 10000]);
  });

  it("fails once the device code's local lifetime is exhausted", async () => {
    // expires_in 10 s with a 5 s interval: the third wait passes the deadline.
    const http = scriptedHttp(deviceBody({ expires_in: 10 }), [
      oauthError("authorization_pending"),
      oauthError("authorization_pending"),
      { access_token: "tok" },
    ]);
    const err = await acquireDeviceSession(baseDeps(http, [], [])).catch((e: Error) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as Error).message).toMatch(/expired/i);
  });

  it("cancels promptly when the abort signal fires", async () => {
    const controller = new AbortController();
    const http = scriptedHttp(deviceBody(), [oauthError("authorization_pending")]);
    const out: string[] = [];
    const deps = baseDeps(http, out, []);
    const err = await acquireDeviceSession({
      ...deps,
      signal: controller.signal,
      // abort while the first wait is in flight, then defer to the real sleep
      _sleep: (ms: number, signal: AbortSignal) => {
        controller.abort();
        return new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new AuthError("Login cancelled.")), {
            once: true,
          });
        });
      },
    }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as Error).message).toBe("Login cancelled.");
  });
});
