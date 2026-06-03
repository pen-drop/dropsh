# Auth Provider Rework — Design

**Date:** 2026-06-03
**Status:** Approved (pending implementation plan)

## Goal

Rework the authentication subsystem into a provider-registry model with a
single active session, modelled on the Claude CLI login experience.

`dropsh auth login` presents an overview of the auth providers that support
interactive login, the user picks one, and that provider authenticates and
stores a session. `auth logout` and `auth status` operate on the same active
session. Only one provider is logged in at a time; a new login replaces the
previous session.

## Background — current state

- `AuthAdapter` is a thin interface with a single method `apply(req)` that
  attaches auth to an outgoing `HttpRequest`.
- `src/index.ts` resolves auth by picking the **first** plugin in
  `config.plugins` that exposes `createAuthAdapter()` — single provider,
  first-wins.
- The `login` command is registered by the oauth2 plugin itself via
  `registerCommands(program)`; only `oauth2_authcode` performs an interactive
  (browser PKCE) login. There is **no** `auth` command group and **no**
  `logout` or `status`.
- Tokens are stored per-host in `~/.config/dropsh/<hostname>.json` (mode
  `0600`) by `plugins/oauth2/src/token-store.ts`.

## Decisions (from brainstorming)

1. **Provider model:** all auth providers available as plugins are listed.
   The registry is built from `config.plugins`; no more first-wins.
2. **Single active session:** only one provider logged in at a time (Claude
   CLI style). A new `auth login` replaces the previous session.
3. **Credentials:** interactive at login, stored in the state dir
   (`~/.config/dropsh`). No secrets in the config file.
4. **Connection params in config:** non-secret params (`client_id`,
   `token_url`, `scope`, `redirect_port`) stay in `config.plugins`. No
   auto-discovery in this iteration. Only tokens/secrets go to the state dir.
5. **Abstraction:** a dedicated, focused `AuthProvider` interface (approach
   A). The thin `AuthAdapter.apply()` remains as the runtime piece, returned
   by `createAdapter`.

## Architecture

### Model & data flow

- **Registry:** the core collects every provider from `config.plugins` that
  carries an `AuthProvider` (via the new optional `authProvider` field on
  `DropSHPlugin`).
- **`dropsh auth login`:** shows a picker of providers whose
  `capabilities.login` is true → selection → `provider.login(ctx)` (browser /
  secret prompt, using non-secret params from config) → writes the session to
  the state dir, replacing any previous session.
- **Runtime** (`read`/`search`/`create`/`update`/`delete`/`upload-file`/
  `schema`): the core reads the session from the state dir →
  `provider.createAdapter(session)` → `apply(req)`. No session → error
  `run dropsh auth login`.
- **`auth logout`:** clears the session. **`auth status`:** shows the active
  provider plus details (host, expiry) or `not logged in`.

### `AuthProvider` interface

```ts
interface AuthProvider {
  id: string;                  // "oauth2-authcode", "oauth2-password", "basic", ...
  displayName: string;         // picker label
  capabilities: { login: boolean; logout: boolean; status: boolean };
  login(ctx: AuthContext): Promise<AuthSession>;     // discovery/prompt/browser → session
  logout(ctx: AuthContext): Promise<void>;
  status(session: AuthSession | null): Promise<StatusInfo>;
  createAdapter(session: AuthSession): AuthAdapter;  // { apply(req) }
}
```

- **`AuthContext`:** `{ baseUrl, prompt(), openBrowser(), stateDir }`. The core
  supplies all I/O so providers stay testable (no direct stdin/stdout/browser
  access inside a provider).
- **`AuthSession`:** a provider-specific JSON blob, opaque to the core — e.g.
  `{ access_token, refresh_token, expires_at }` for oauth2 or `{ basic_b64 }`
  for basic auth.
- **`StatusInfo`:** `{ loggedIn: boolean; provider?: string; host?: string;
  expiresAt?: number; state?: "valid" | "expired" }`.
- **`DropSHPlugin`** gains an optional `authProvider?: AuthProvider`. The old
  `createAuthAdapter()` is removed; the session flow replaces it.

### Commands & picker

New `auth` command group in the core (`src/index.ts`), replacing the
plugin-registered top-level `login`.

- **`dropsh auth login [--provider <id>]`**
  - Collects providers with `capabilities.login`.
  - Zero → error `no login-capable auth provider configured`.
  - `--provider <id>` set → use it directly; unknown id → error listing valid
    ids.
  - Otherwise an interactive numbered picker keyed on `displayName`. Exactly
    one provider → use it directly (less friction).
  - Selection → `provider.login(ctx)` → session → write state
    (`activeProvider` + `session`), overwriting any previous session.
  - Success: `logged in via <displayName>` on stdout.
  - Non-TTY (CI/pipe) without `--provider` → error
    `non-interactive: pass --provider`.
- **`dropsh auth logout`** — reads the active session; none → `not logged in`
  (exit 0). Otherwise `provider.logout(ctx)` (best-effort token revoke) and
  delete the state file.
- **`dropsh auth status [--json]`** — no session → `not logged in` (exit 0).
  Otherwise `provider.status(session)` → provider display name, host,
  `expires_at` (for oauth), and `valid`/`expired`. `--json` for machine output.

### State store

Generalise `plugins/oauth2/src/token-store.ts` into a core session store at
`src/core/auth/session-store.ts` (now used across the core, not just oauth2).

- Path: `~/.config/dropsh/<hostname>.json`, mode `0600` (unchanged). Per-host
  so multiple sites each keep one active session.
- Shape:

```json
{
  "activeProvider": "oauth2-authcode",
  "session": { "access_token": "…", "refresh_token": "…", "expires_at": 1730000000 }
}
```

- API: `readSession(baseUrl)`, `writeSession(baseUrl, providerId, session)`,
  `clearSession(baseUrl)`, with a `stateDir` override for tests.
- The oauth2 plugin uses the core store via `AuthContext.stateDir` instead of
  its own `token-store.ts`, which is removed/migrated.

### Providers

- **`oauth2-authcode`** (`@dropsh/plugin-oauth2`): `login` = the existing PKCE
  browser flow (`login.ts` / `oauth2-authcode.ts`) → `{access_token,
  refresh_token, expires_at}`. `capabilities.login = true`. `createAdapter` =
  Bearer header with refresh on expiry. `logout` = best-effort token revoke +
  clear. `status` = expiry/validity.
- **`oauth2-password`**: `login` prompts for the password (username from
  config), fetches a token. `capabilities.login = true`.
- **`oauth2-client-credentials`**: `login` prompts for `client_secret` once,
  fetches a token. Machine flow — `login = true` (appears in the picker), no
  browser.
- **`basic`** (core): `login` prompts for `username` + `password` → session
  `{ basic_b64 }`. `capabilities.login = true`. `createAdapter` =
  `Authorization: Basic`. `logout` = clear. No server-side revoke.

Providers declare their own `capabilities`; the picker shows only
`login: true`. Config plugins still carry the non-secret params (`client_id`,
`token_url`, `scope`, `redirect_port`).

### Errors

- Reuse the existing `AuthError` / `ConfigError`.
- No provider configured → `ConfigError`.
- Login-flow failures (browser timeout, token rejected) → `AuthError`, with the
  existing exit-code behaviour.
- Runtime with no session → `AuthError` `run dropsh auth login`.

### Testing

- **Unit:** `AuthContext` is mockable (injected `prompt` / `openBrowser` /
  `stateDir`), so each provider's `login` / `logout` / `status` is testable in
  isolation without real stdin, browser, or HTTP.
- **Session store:** tmp `stateDir`, round-trip read/write/clear, assert mode
  `0600`.
- **Picker/dispatch (core):** fake provider registry; cover `--provider`,
  non-TTY error, empty registry, single-provider shortcut.
- **Integration (DDEV, local):** real `oauth2-password` and
  `oauth2-client-credentials` against `simple_oauth`; the authcode/browser flow
  stays manual.
- **Migration:** port the old `token-store.ts` tests to the session store.

## Out of scope

- OpenID Connect / `.well-known` auto-discovery of `token_url` and scopes
  (possible future iteration).
- Multiple simultaneously logged-in providers / per-request provider selection.
- Storing non-secret connection params anywhere other than `config.plugins`.
