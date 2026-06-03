import type { HttpClient, HttpRequest } from "../http.js";

export interface AuthAdapter {
  apply(req: HttpRequest): Promise<HttpRequest>;
}

/** Provider-specific opaque session payload persisted to the state dir. */
export type AuthSession = Record<string, unknown>;

export interface AuthStatusInfo {
  loggedIn: boolean;
  provider?: string;
  host?: string;
  expiresAt?: number;
  state?: "valid" | "expired";
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
  readonly capabilities: { login: boolean; logout: boolean; status: boolean };
  login(ctx: AuthContext): Promise<AuthSession>;
  logout(ctx: AuthContext): Promise<void>;
  status(session: AuthSession | null): Promise<AuthStatusInfo>;
  createAdapter(session: AuthSession, rt: AdapterRuntime): AuthAdapter;
}
