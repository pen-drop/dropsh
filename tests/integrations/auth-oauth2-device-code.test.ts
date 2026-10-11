import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHttpClient, type HttpClient, HttpError, type HttpRequest } from "dropsh/plugin";
import { describe, expect, it } from "vitest";
import { oauth2Plugin } from "../../plugins/oauth2/src/index.js";
import { readOAuthError } from "../../plugins/oauth2/src/token.js";
import { runAuthLogin } from "../../src/commands/auth.js";
import { readProfiles } from "../../src/core/auth/session-store.js";
import { createTestNode, oauth2DeviceCode, runCli, testConfig } from "./helpers/run.js";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

interface ObservedRequest {
  url: string;
  method: string;
  body?: string;
}

class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(res: Response): void {
    const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const cookie of raw) {
      const pair = cookie.split(";", 1)[0];
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

function formHtml(page: string, formId: string): string {
  const match = new RegExp(`<form\\b[^>]*\\bid=["']${formId}["'][^>]*>[\\s\\S]*?</form>`, "i").exec(
    page,
  );
  if (!match) throw new Error(`missing form ${formId}`);
  return match[0];
}

function hiddenValue(html: string, name: string): string {
  const named = new RegExp(
    `name=["']${name}["'][^>]*value=["']([^"']+)["']|value=["']([^"']+)["'][^>]*name=["']${name}["']`,
    "i",
  );
  const match = named.exec(html);
  const value = match?.[1] ?? match?.[2];
  if (!value) throw new Error(`missing form field ${name}`);
  return value;
}

function optionalHidden(html: string, name: string): string | undefined {
  try {
    return hiddenValue(html, name);
  } catch {
    return undefined;
  }
}

async function fetchFollow(url: string, init: RequestInit, jar: CookieJar): Promise<Response> {
  let current = url;
  let currentInit = init;
  for (let hop = 0; hop < 8; hop++) {
    const headers = new Headers(currentInit.headers);
    const cookie = jar.header();
    if (cookie) headers.set("Cookie", cookie);
    const res = await fetch(current, { ...currentInit, headers, redirect: "manual" });
    jar.absorb(res);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      current = new URL(location, current).href;
      currentInit = { method: "GET" };
      continue;
    }
    return res;
  }
  throw new Error(`too many redirects from ${url}`);
}

async function loginTester(baseUrl: string): Promise<CookieJar> {
  const jar = new CookieJar();
  const root = baseUrl.replace(/\/$/, "");
  const loginUrl = `${root}/user/login`;
  const formPage = await fetchFollow(loginUrl, { method: "GET" }, jar);
  const html = formHtml(await formPage.text(), "user-login-form");
  const body = new URLSearchParams({
    name: "tester",
    pass: "tester-pw",
    form_id: hiddenValue(html, "form_id"),
    form_build_id: hiddenValue(html, "form_build_id"),
    op: "Log in",
  });
  const formToken = optionalHidden(html, "form_token");
  if (formToken) body.set("form_token", formToken);
  const posted = await fetchFollow(
    loginUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    jar,
  );
  if (!posted.ok && posted.status !== 303 && posted.status !== 302) {
    throw new Error(`tester login failed: HTTP ${posted.status}`);
  }
  const me = await fetchFollow(`${root}/user`, { method: "GET" }, jar);
  const meHtml = await me.text();
  if (!/\/user\/logout/.test(meHtml)) {
    throw new Error(`tester login did not establish a session: HTTP ${me.status}`);
  }
  return jar;
}

async function approveDevice(baseUrl: string, userCode: string, jar: CookieJar): Promise<void> {
  const verifyUrl = `${baseUrl.replace(/\/$/, "")}/oauth/device?user_code=${encodeURIComponent(userCode)}`;
  const page = await fetchFollow(verifyUrl, { method: "GET" }, jar);
  const html = formHtml(await page.text(), "simple-oauth-device-flow-verification-form");
  const body = new URLSearchParams({
    user_code: userCode,
    form_id: hiddenValue(html, "form_id"),
    form_build_id: hiddenValue(html, "form_build_id"),
    form_token: hiddenValue(html, "form_token"),
    op: "Authorize Device",
  });
  const posted = await fetchFollow(
    verifyUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    jar,
  );
  if (!posted.ok && posted.status !== 303 && posted.status !== 302) {
    throw new Error(`device approval failed: HTTP ${posted.status}`);
  }
  const confirmation = await posted.text();
  if (!/Device authorized successfully/i.test(confirmation)) {
    throw new Error(`device approval did not confirm: HTTP ${posted.status}`);
  }
}

function parseUserCode(stdout: string): string | undefined {
  const match = /enter this code:\s+(\S+)/i.exec(stdout);
  return match?.[1];
}

async function waitUntil(label: string, pred: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function observingHttp(inner: HttpClient): {
  http: HttpClient;
  observedRequests: ObservedRequest[];
  observedTokenGrants: string[];
  get observedPending(): boolean;
  stop: () => void;
} {
  const observedRequests: ObservedRequest[] = [];
  const observedTokenGrants: string[] = [];
  let observedPending = false;
  let stopped = false;
  return {
    observedRequests,
    observedTokenGrants,
    get observedPending() {
      return observedPending;
    },
    stop() {
      stopped = true;
    },
    http: {
      async send(req: HttpRequest) {
        if (stopped) throw new Error("test finished");
        observedRequests.push({
          url: req.url,
          method: req.method,
          ...(typeof req.body === "string" ? { body: req.body } : {}),
        });
        if (typeof req.body === "string") {
          const grant = new URLSearchParams(req.body).get("grant_type");
          if (grant) observedTokenGrants.push(grant);
        }
        try {
          return await inner.send(req);
        } catch (err) {
          if (err instanceof HttpError && readOAuthError(err.body) === "authorization_pending") {
            observedPending = true;
          }
          throw err;
        }
      },
    },
  };
}

describe("integration: auth oauth2 device code", () => {
  it("completes the live device-code grant and reuses the saved session for a CLI read", async () => {
    const uuid = await createTestNode(`it-auth-device-${crypto.randomUUID()}`);
    const cfg = testConfig("plain");
    const device = oauth2DeviceCode("plain");
    const home = mkdtempSync(join(tmpdir(), "dropsh-device-home-"));
    const stateDir = join(home, ".config", "dropsh");
    const inner = createHttpClient({ timeoutMs: 30_000 });
    const observed = observingHttp(inner);
    let stdoutBuf = "";
    const plugin = oauth2Plugin({
      type: "oauth2_device_code",
      client_id: device.clientId,
      device_authorization_url: device.deviceAuthorizationUrl,
      token_url: device.tokenUrl,
      ...(device.scope ? { scope: device.scope } : {}),
    });
    const provider = plugin.authProvider;
    if (!provider) throw new Error("oauth2_device_code plugin has no authProvider");
    const login = runAuthLogin(
      { provider: "oauth2_device_code" },
      {
        baseUrl: cfg.url,
        providers: [provider],
        stdout: (chunk) => {
          stdoutBuf += chunk;
        },
        stderr: () => {},
        prompt: async () => {
          throw new Error("the device flow must not prompt");
        },
        openBrowser: async () => {
          throw new Error("the device flow must not open a browser");
        },
        http: observed.http,
        now: () => Date.now(),
        isTTY: false,
        stateDir,
      },
    );

    let jar: CookieJar | undefined;
    try {
      await waitUntil("device user code", () => Boolean(parseUserCode(stdoutBuf)), 20_000);
      const userCode = parseUserCode(stdoutBuf);
      if (!userCode) throw new Error("device login printed no user code");
      await waitUntil("authorization_pending", () => observed.observedPending, 30_000);
      jar = await loginTester(cfg.url);
      await approveDevice(cfg.url, userCode, jar);
      await login;

      expect(
        observed.observedRequests.some((r) => r.url.endsWith("/oauth/device_authorization")),
      ).toBe(true);
      expect(observed.observedTokenGrants).toContain(DEVICE_GRANT);
      expect(observed.observedPending).toBe(true);

      const file = await readProfiles(cfg.url, stateDir);
      expect(file?.active).toBe("oauth2_device_code");
      const savedDeviceProfile = file?.profiles.oauth2_device_code;
      expect(savedDeviceProfile?.provider).toBe("oauth2_device_code");
      expect(savedDeviceProfile?.session.access_token).toEqual(expect.any(String));

      const secondProcessRead = await runCli({
        site: "plain",
        home,
        auth: device,
        args: ["read", `node/article_test/${uuid}`],
      });
      expect(secondProcessRead.code, secondProcessRead.stderr || secondProcessRead.stdout).toBe(0);
    } finally {
      observed.stop();
      await login.catch(() => {});
    }
  }, 120_000);
});
