import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AuthSession, HttpClient } from "dropsh/plugin";
import { AuthError } from "dropsh/plugin";

const DEFAULT_PORT = 7432;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(96).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(16).toString("base64url");
}

interface CallbackDeps {
  port: number;
  state: string;
  timeoutMs: number;
  authUrl: URL;
  deps: { openBrowser: (url: string) => Promise<void>; stdout: (s: string) => void };
}

function waitForCallbackCode(c: CallbackDeps): Promise<string> {
  const { port, state, timeoutMs, authUrl } = c;
  const stdout = c.deps.stdout;
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close(() => fn());
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body><p>Login successful. You can close this tab.</p></body></html>");
      const receivedState = url.searchParams.get("state");
      const receivedCode = url.searchParams.get("code");
      if (receivedState !== state) {
        finish(() => reject(new AuthError("OAuth state mismatch — possible CSRF attack")));
        return;
      }
      if (!receivedCode) {
        finish(() => reject(new AuthError("No authorization code received")));
        return;
      }
      finish(() => resolve(receivedCode));
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        finish(() =>
          reject(
            new AuthError(
              `Port ${port} is already in use. A previous login may still be running — kill it and retry.`,
            ),
          ),
        );
      } else {
        finish(() => reject(err));
      }
    });

    const timer = setTimeout(() => {
      finish(() => reject(new AuthError("Login timed out. Run 'dropsh auth login' to try again.")));
    }, timeoutMs);

    server.listen(port, () => {
      stdout("Opening browser for login...");
      stdout(`If the browser does not open, visit:\n${authUrl.toString()}`);
      c.deps.openBrowser(authUrl.toString()).catch(() => {
        // URL is printed above — user can open it manually.
      });
    });
  });
}

export interface AcquireAuthCodeDeps {
  baseUrl: string;
  clientId: string;
  tokenUrl: string;
  scope?: string;
  redirectPort?: number;
  http: HttpClient;
  openBrowser: (url: string) => Promise<void>;
  stdout: (s: string) => void;
  now: () => number;
  timeoutMs?: number;
  _generatePkce?: () => { verifier: string; challenge: string };
  _generateState?: () => string;
}

/** Runs the PKCE browser flow and returns an AuthSession (no persistence). */
export async function acquireAuthCodeSession(deps: AcquireAuthCodeDeps): Promise<AuthSession> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const port = deps.redirectPort ?? DEFAULT_PORT;
  const pkce = (deps._generatePkce ?? generatePkce)();
  const state = (deps._generateState ?? generateState)();
  const baseUrl = deps.baseUrl.replace(/\/$/, "");
  const redirectUri = `http://localhost:${port}/callback`;
  const authUrl = new URL(`${baseUrl}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", deps.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("code_challenge", pkce.challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  if (deps.scope) authUrl.searchParams.set("scope", deps.scope);

  const code = await waitForCallbackCode({
    port,
    state,
    timeoutMs,
    authUrl,
    deps: { openBrowser: deps.openBrowser, stdout: deps.stdout },
  });

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: pkce.verifier,
    client_id: deps.clientId,
    redirect_uri: redirectUri,
  });
  const res = await deps.http.send({
    method: "POST",
    url: deps.tokenUrl,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const body = JSON.parse(res.body) as {
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
    expires_at: deps.now() + ttlSec * 1000 - 5000,
  };
}
