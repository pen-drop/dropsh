import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { writeToken } from "../core/auth/token-store.js";
import { loadConfig } from "../core/config.js";
import { createHttpClient, type HttpClient } from "../core/http.js";
import { AuthError } from "../errors.js";

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
  http?: HttpClient;
  now?: () => number;
  timeoutMs?: number;
  tokenDir?: string;
  _generatePkce?: () => { verifier: string; challenge: string };
  _generateState?: () => string;
}

export async function runLogin(deps: LoginDeps = {}): Promise<void> {
  const stdout = deps.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const configPath = deps.configPath ?? (process.env.DRUPAL_CLI_CONFIG ?? ".drupal-cli.yml");
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = deps.now ?? Date.now;
  const http = deps.http ?? createHttpClient();
  const pkce = (deps._generatePkce ?? generatePkce)();
  const state = (deps._generateState ?? generateState)();

  const cfg = await loadConfig(configPath);
  const { auth, base_url: baseUrl } = cfg.site;
  if (auth.type !== "oauth2_authcode") {
    throw new AuthError("login requires auth.type: oauth2_authcode in config");
  }

  const clientId = auth.client_id;
  if (typeof clientId !== "string" || clientId.length === 0) {
    throw new AuthError("oauth2_authcode auth requires client_id");
  }

  const scope = typeof auth.scope === "string" ? auth.scope : "";
  const port = typeof auth.redirect_port === "number" ? auth.redirect_port : DEFAULT_PORT;
  const redirectUri = `http://localhost:${port}/callback`;
  const baseUrlNorm = baseUrl.replace(/\/$/, "");
  const tokenEndpoint = `${baseUrlNorm}/oauth/token`;
  const authUrl = new URL(`${baseUrlNorm}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("code_challenge", pkce.challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  if (scope) authUrl.searchParams.set("scope", scope);

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

    server.on("error", (err) => {
      finish(() => reject(err));
    });

    const timer = setTimeout(() => {
      finish(() => reject(new AuthError("Login timed out. Run 'drupal-cli login' to try again.")));
    }, timeoutMs);

    server.listen(port, () => {
      stdout("Opening browser for login...");
      stdout(`If the browser does not open, visit:\n${authUrl.toString()}`);

      const openBrowser = deps.openBrowser ?? (async (url: string) => {
        const { default: open } = await import("open");
        await open(url);
      });

      openBrowser(authUrl.toString()).catch(() => {
        // The URL is printed above, so the user still has a manual fallback.
      });
    });
  });

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: pkce.verifier,
    client_id: clientId,
    redirect_uri: redirectUri,
  });

  const res = await http.send({
    method: "POST",
    url: tokenEndpoint,
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
    baseUrl,
    {
      access_token: body.access_token,
      ...(typeof body.refresh_token === "string" ? { refresh_token: body.refresh_token } : {}),
      expires_at: expiresAt,
    },
    deps.tokenDir,
  );

  stdout(`Logged in · token valid until ${new Date(expiresAt).toISOString()}`);
}
