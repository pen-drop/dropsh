import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { HttpClient } from "dropsh/plugin";
import { AuthError, createHttpClient, loadConfig } from "dropsh/plugin";
import { writeToken } from "./token-store.js";

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

export interface LoginDeps {
  stdout?: (s: string) => void;
  openBrowser?: (url: string) => Promise<void>;
  configPath?: string;
  clientId: string;
  tokenUrl: string;
  scope?: string;
  redirectPort?: number;
  http?: HttpClient;
  now?: () => number;
  timeoutMs?: number;
  tokenDir?: string;
  _generatePkce?: () => { verifier: string; challenge: string };
  _generateState?: () => string;
}

export async function runLogin(deps: LoginDeps): Promise<void> {
  const stdout = deps.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const configPath = deps.configPath ?? process.env.DROPSH_CONFIG ?? "dropsh.config.js";
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = deps.now ?? Date.now;
  const http = deps.http ?? createHttpClient();
  const port = deps.redirectPort ?? DEFAULT_PORT;
  const pkce = (deps._generatePkce ?? generatePkce)();
  const state = (deps._generateState ?? generateState)();

  // Load config only for base_url (for the authorize endpoint)
  const cfg = await loadConfig(configPath);
  const baseUrl = cfg.site.base_url.replace(/\/$/, "");
  // Use same key as createOAuth2AuthCodeAuth so tokens are interchangeable
  const tokenStorageKey = deps.tokenUrl.replace(/\/oauth\/token$/, "");
  const redirectUri = `http://localhost:${port}/callback`;
  const authUrl = new URL(`${baseUrl}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", deps.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("code_challenge", pkce.challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  if (deps.scope) authUrl.searchParams.set("scope", deps.scope);

  const code = await new Promise<string>((resolve, reject) => {
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
      finish(() => reject(new AuthError("Login timed out. Run 'dropsh login' to try again.")));
    }, timeoutMs);

    server.listen(port, () => {
      stdout("Opening browser for login...");
      stdout(`If the browser does not open, visit:\n${authUrl.toString()}`);
      const openBrowser =
        deps.openBrowser ??
        (async (url: string) => {
          const { default: open } = await import("open");
          await open(url);
        });
      openBrowser(authUrl.toString()).catch(() => {
        // URL is printed above — user can open it manually.
      });
    });
  });

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: pkce.verifier,
    client_id: deps.clientId,
    redirect_uri: redirectUri,
  });

  const res = await http.send({
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
  if (typeof body.access_token !== "string") {
    throw new AuthError("Token endpoint returned no access_token");
  }

  const ttlSec = typeof body.expires_in === "number" ? body.expires_in : 3600;
  const expiresAt = now() + ttlSec * 1000 - 5000;
  await writeToken(
    tokenStorageKey,
    {
      access_token: body.access_token,
      ...(typeof body.refresh_token === "string" ? { refresh_token: body.refresh_token } : {}),
      expires_at: expiresAt,
    },
    deps.tokenDir,
  );

  stdout(`Logged in · token valid until ${new Date(expiresAt).toISOString()}`);
}
