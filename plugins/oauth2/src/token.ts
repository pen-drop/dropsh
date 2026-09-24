import type { AuthSession } from "dropsh/plugin";
import { AuthError } from "dropsh/plugin";

/**
 * Parse an RFC 6749 token response body into an AuthSession. Shared by the
 * authcode, device and client-credentials paths so the TTL margin and the
 * missing-access_token guard exist once.
 */
export function parseTokenResponse(rawBody: string, now: () => number): AuthSession {
  const body = JSON.parse(rawBody) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof body.access_token !== "string")
    throw new AuthError("Token endpoint returned no access_token");
  const ttlSec = typeof body.expires_in === "number" ? body.expires_in : 3600;
  return {
    access_token: body.access_token,
    ...(typeof body.refresh_token === "string" ? { refresh_token: body.refresh_token } : {}),
    expires_at: now() + ttlSec * 1000 - 5000,
  };
}

/**
 * Read the RFC 6749 `error` code from an error response. The body may already be
 * an object (as our tests and some clients provide) or the raw JSON string the
 * real http client carries; parse defensively and return the `error` field only
 * when it is a string.
 */
export function readOAuthError(body: unknown): string | undefined {
  let parsed: unknown = body;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    const code = (parsed as { error?: unknown }).error;
    if (typeof code === "string") return code;
  }
  return undefined;
}
