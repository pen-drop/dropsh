import type { AuthSession, HttpClient } from "dropsh/plugin";
import { AuthError, HttpError } from "dropsh/plugin";
import { parseTokenResponse, readOAuthError } from "./token.js";

const DEFAULT_INTERVAL_SEC = 5;
const SLOW_DOWN_INCREMENT_SEC = 5;
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

/** The RFC 8628 §3.2 fields we require, plus the two optional ones we honour. */
interface DeviceAuthorization {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval?: number;
  verification_uri_complete?: string;
}

export interface AcquireDeviceDeps {
  clientId: string;
  deviceAuthorizationUrl: string;
  tokenUrl: string;
  scope?: string;
  http: HttpClient;
  stdout: (s: string) => void;
  now: () => number;
  /** Injected in tests so no wall-clock time passes. */
  _sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Injected in tests to drive the cancellation path without a real SIGINT. */
  signal?: AbortSignal;
}

/** Resolves after `ms`, or rejects immediately once `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AuthError("Login cancelled."));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new AuthError("Login cancelled."));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function requestDeviceAuthorization(deps: AcquireDeviceDeps): Promise<DeviceAuthorization> {
  const params = new URLSearchParams({ client_id: deps.clientId });
  if (deps.scope) params.set("scope", deps.scope);
  let raw: string;
  try {
    const res = await deps.http.send({
      method: "POST",
      url: deps.deviceAuthorizationUrl,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    raw = res.body;
  } catch (err) {
    const code = err instanceof HttpError ? readOAuthError(err.body) : undefined;
    throw new AuthError(
      `Device authorization request rejected (client_id "${deps.clientId}") at ` +
        `${deps.deviceAuthorizationUrl}: ${code ?? "request_failed"}.`,
      { reason: code ?? "request_failed", client_id: deps.clientId },
    );
  }
  const body = JSON.parse(raw) as Record<string, unknown>;
  const str = (k: string): string => {
    const v = body[k];
    if (typeof v !== "string" || v.length === 0)
      throw new AuthError(
        `Device authorization response from ${deps.deviceAuthorizationUrl} is missing "${k}".`,
      );
    return v;
  };
  if (typeof body.expires_in !== "number")
    throw new AuthError(
      `Device authorization response from ${deps.deviceAuthorizationUrl} is missing "expires_in".`,
    );
  return {
    device_code: str("device_code"),
    user_code: str("user_code"),
    verification_uri: str("verification_uri"),
    expires_in: body.expires_in,
    ...(typeof body.interval === "number" ? { interval: body.interval } : {}),
    ...(typeof body.verification_uri_complete === "string"
      ? { verification_uri_complete: body.verification_uri_complete }
      : {}),
  };
}

/**
 * Print the activation instructions. Deliberately never opens a browser: the
 * flow exists for machines whose local browser is on the wrong host, so URL and
 * code must stay readable and usable on a second device.
 */
function announce(auth: DeviceAuthorization, stdout: (s: string) => void): void {
  stdout(`Open ${auth.verification_uri}\nand enter this code:\n\n    ${auth.user_code}\n`);
  if (auth.verification_uri_complete)
    stdout(`Or open this link directly:\n${auth.verification_uri_complete}\n`);
  stdout("Waiting for confirmation ...");
}

function deviceErrorMessage(code: string): string {
  if (code === "access_denied") return "The login was denied on the confirmation page.";
  if (code === "expired_token")
    return "The device code expired before the login was confirmed. Run 'dropsh auth login' to try again.";
  return `Device login failed: ${code}.`;
}

/**
 * RFC 8628 §3.4/§3.5: wait *before* every request, keep waiting on
 * `authorization_pending`, raise the interval permanently on `slow_down`, and
 * treat every other OAuth error as terminal so no code is polled forever. A
 * transport failure carries no OAuth code, so it backs off and retries until the
 * device code's own lifetime runs out.
 */
async function pollForToken(
  deps: AcquireDeviceDeps,
  auth: DeviceAuthorization,
  signal: AbortSignal,
): Promise<AuthSession> {
  const wait = deps._sleep ?? sleep;
  const deadline = deps.now() + auth.expires_in * 1000;
  let intervalSec = auth.interval ?? DEFAULT_INTERVAL_SEC;
  const params = new URLSearchParams({
    grant_type: DEVICE_GRANT,
    device_code: auth.device_code,
    client_id: deps.clientId,
  });

  for (;;) {
    await wait(intervalSec * 1000, signal);
    if (deps.now() >= deadline)
      throw new AuthError(
        "The device code expired before the login was confirmed. " +
          "Run 'dropsh auth login' to try again.",
        { reason: "expired_token", client_id: deps.clientId },
      );
    try {
      const res = await deps.http.send({
        method: "POST",
        url: deps.tokenUrl,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      return parseTokenResponse(res.body, deps.now);
    } catch (err) {
      if (err instanceof AuthError) throw err;
      const code = err instanceof HttpError ? readOAuthError(err.body) : undefined;
      if (code === "authorization_pending") continue;
      if (code === "slow_down") {
        intervalSec += SLOW_DOWN_INCREMENT_SEC;
        continue;
      }
      if (code === undefined) {
        // No OAuth code: a transport or connection failure. Poll less often
        // rather than giving up — the deadline above still bounds the loop.
        intervalSec += SLOW_DOWN_INCREMENT_SEC;
        continue;
      }
      throw new AuthError(deviceErrorMessage(code), { reason: code, client_id: deps.clientId });
    }
  }
}

export async function acquireDeviceSession(deps: AcquireDeviceDeps): Promise<AuthSession> {
  const auth = await requestDeviceAuthorization(deps);
  announce(auth, deps.stdout);

  // Ctrl+C during the wait must end the login with a clear message rather than a
  // half-finished flow. The listener is temporary: once polling is over the CLI
  // gets its default SIGINT behaviour back.
  const controller = new AbortController();
  const signal = deps.signal ?? controller.signal;
  const sigintHandler = (): void => controller.abort();
  process.on("SIGINT", sigintHandler);

  // A cancellation promise with its listener registered up front, so an abort
  // fired from inside a mocked/real wait call is still observed even when that
  // wait call's own listener was registered too late (AbortSignal does not
  // replay an event to a listener added after it already fired).
  let rejectCancelled: (err: Error) => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCancelled = reject;
  });
  const onAbort = (): void => rejectCancelled(new AuthError("Login cancelled."));
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });

  try {
    return await Promise.race([pollForToken(deps, auth, signal), cancelled]);
  } finally {
    process.off("SIGINT", sigintHandler);
    signal.removeEventListener("abort", onAbort);
  }
}
