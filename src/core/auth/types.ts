import type { HttpClient, HttpRequest } from "../http.js";

/**
 * Outcome of a reactive credential renewal. On failure the renewal cause is
 * carried back so the caller can surface *why* renewal failed instead of the
 * bare, unexplained 401 that first triggered it.
 */
export type RenewOutcome = { ok: true } | { ok: false; cause?: unknown };

export interface AuthAdapter {
  apply(req: HttpRequest): Promise<HttpRequest>;
  /**
   * Force a credential refresh after the server rejected the current token (401),
   * then persist it. Resolves `{ ok: true }` when renewal succeeded (caller
   * retries the request once) or `{ ok: false, cause }` when it could not renew,
   * where `cause` is the error explaining the failure (the caller surfaces it in
   * place of the original 401). Providers that cannot renew (e.g. basic auth)
   * omit this method.
   */
  renew?(): Promise<RenewOutcome>;
}

/** Provider-specific opaque session payload persisted to the state dir. */
export type AuthSession = Record<string, unknown>;

export interface AuthStatusInfo {
  loggedIn: boolean;
  provider?: string;
  host?: string;
  expiresAt?: number;
  state?: "valid" | "expired";
  sessionless?: boolean;
}

/** I/O the core supplies to a provider during login/logout so providers stay testable. */
export interface AuthContext {
  baseUrl: string;
  http: HttpClient;
  /** State dir override (tests). Undefined → provider uses the default (~/.config/dropsh). */
  stateDir?: string;
  prompt(opts: { label: string; secret?: boolean }): Promise<string>;
  openBrowser(url: string): Promise<void>;
  stdout(s: string): void;
  now(): number;
}

/** Runtime helpers handed to createAdapter so a provider can refresh + persist its session. */
export interface AdapterRuntime {
  http: HttpClient;
  now(): number;
  /** Persist a refreshed session back to the active session slot. */
  save(session: AuthSession): Promise<void>;
}

export interface AuthProvider {
  readonly id: string;
  readonly displayName: string;
  /** When true, this provider is the fallback profile if none is active/selected. */
  readonly default?: boolean;
  readonly capabilities: { login: boolean; logout: boolean; status: boolean };
  login(ctx: AuthContext): Promise<AuthSession>;
  logout(ctx: AuthContext): Promise<void>;
  status(session: AuthSession | null): Promise<AuthStatusInfo>;
  createAdapter(session: AuthSession | undefined, rt: AdapterRuntime): AuthAdapter;
}
