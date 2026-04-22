# drupal-cli login — OAuth2 Authorization Code + PKCE Design

**Date:** 2026-04-22
**Status:** Approved for implementation planning

---

## 1. Purpose

Add a `drupal-cli login` command that authenticates the operator against a
Drupal site via the OAuth 2.0 Authorization Code flow with PKCE. The resulting
tokens are stored on disk so that subsequent commands (`read`, `search`,
`create`, …) can authenticate without user interaction.

## 2. Goals

- Interactive browser-based login: no credentials in the config file.
- Secure by default: PKCE eliminates the need for a client secret.
- Transparent token lifecycle: automatic silent refresh; clear error when
  re-login is required.
- Pure Node.js: no native addons, no OS-keychain dependency.

## 3. Non-goals (this spec)

- `logout` command (trivial follow-up: delete token file).
- AI skill for initial setup / guided configuration.
- Integration test for the browser-based login flow (not automatable in DDEV).
- Multi-profile / multi-site support (one project = one site).

## 4. Config Schema

A new `auth.type` value `oauth2_authcode` is added to `.drupal-cli.yml`:

```yaml
site:
  base_url: https://example.com
  auth:
    type: oauth2_authcode
    client_id: my-drupal-client        # required
    scope: "openid offline_access"     # optional — "offline_access" needed for refresh tokens
    redirect_port: 7432                # optional, default: 7432
```

**No `client_secret`** — Drupal must have the client configured as public
(PKCE-only). The fixed redirect URI to register in Drupal:
`http://localhost:7432/callback` (or the configured port).

`src/core/config.ts` accepts `"oauth2_authcode"` as a valid `auth.type` value.

## 5. Token Storage

Tokens are persisted to:

```
~/.config/drupal-cli/<hostname>.json
```

where `<hostname>` is derived from `base_url` (e.g. `example.com`).

**File format:**

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_at": 1714000000000
}
```

- `expires_at` is a Unix timestamp in milliseconds.
- File permissions are set to `0600` on creation.
- `refresh_token` may be absent if Drupal does not issue one (scope without
  `offline_access`).
- The `~/.config/drupal-cli/` directory is created automatically (`mkdir -p`)
  if it does not exist.

Token read/write is encapsulated in `src/core/auth/token-store.ts`.

## 6. `login` Command Flow

`drupal-cli login` executes the following steps:

1. **Load config** — read `base_url`, `client_id`, `scope`, `redirect_port`
   from `.drupal-cli.yml`.
2. **Generate PKCE** — `code_verifier`: 96 random bytes encoded as Base64url
   (Node `crypto.randomBytes`). `code_challenge = Base64url(SHA-256(verifier))`.
3. **Generate state** — 16 random bytes encoded as Base64url (CSRF protection).
4. **Start localhost server** — temporary `http.createServer` on
   `redirect_port` (default `7432`), listening for `GET /callback`.
5. **Open browser** — build the authorization URL and open it via the `open`
   npm package. Simultaneously print the URL to stdout in case the browser
   does not open automatically.
6. **Receive callback** — extract `code` and `state` from the query string.
   Validate `state` against the generated value; abort on mismatch.
   Shut the server down immediately after receiving the request.
7. **Exchange code for tokens** — POST to `<base_url>/oauth/token`:
   - `grant_type=authorization_code`
   - `code=<received code>`
   - `code_verifier=<generated verifier>`
   - `client_id=<from config>`
   - `redirect_uri=http://localhost:<port>/callback`
8. **Store tokens** — write access token, refresh token, and `expires_at` to
   `~/.config/drupal-cli/<hostname>.json` with permissions `0600`.
9. **Success message** — print `Logged in · token valid until <ISO datetime>`
   to stdout.

**Timeout:** If the user does not complete the browser flow within 5 minutes,
the CLI closes the server and exits with an error:
`"Login timed out. Run 'drupal-cli login' to try again."`

## 7. Token Usage in Other Commands

`factory.ts` gains a new case for `"oauth2_authcode"` that instantiates
`createOAuth2AuthCodeAuth` from `src/core/auth/oauth2-authcode.ts`.

On every outgoing request, the adapter:

1. Reads `~/.config/drupal-cli/<hostname>.json`.
2. If `access_token` is present and `expires_at - 30 000 ms > Date.now()`,
   attaches `Authorization: Bearer <access_token>`.
3. If the access token is expired and a `refresh_token` is present, posts to
   `/oauth/token` with `grant_type=refresh_token`, writes the new tokens to
   disk, and attaches the new access token.
4. If the refresh request fails or no refresh token is present, throws
   `AuthError("Session expired. Run 'drupal-cli login' to authenticate.")`.

No in-memory token cache — each CLI invocation is a separate process; the
token file is the sole state store.

## 8. New / Changed Files

| Path | Change |
|---|---|
| `src/commands/login.ts` | New — PKCE, localhost server, browser open, token exchange |
| `src/core/auth/token-store.ts` | New — read/write `~/.config/drupal-cli/<hostname>.json` |
| `src/core/auth/oauth2-authcode.ts` | New — AuthAdapter: read token, silent refresh |
| `src/core/auth/factory.ts` | Add `case "oauth2_authcode"` |
| `src/core/config.ts` | Add `"oauth2_authcode"` to `AuthConfig.type` union |
| `src/index.ts` | Register `login` command |
| `package.json` | Add `open` dependency |

## 9. Dependencies

| Package | Purpose |
|---|---|
| `open` | Open URLs in the system browser — ESM-compatible, no native addon |

No other new runtime dependencies. PKCE crypto uses Node's built-in `crypto`
module.

## 10. Testing

**Unit tests (new):**

- `tests/unit/core/auth/token-store.test.ts`
  - Read existing token file.
  - Write token file, verify `0600` permissions.
  - Return `null` for missing file.

- `tests/unit/core/auth/oauth2-authcode.test.ts`
  - Valid token attached to request without network call.
  - Expired token triggers refresh; new token written to store.
  - Refresh failure → `AuthError` with correct message.
  - Missing token file → `AuthError` directing user to `login`.

- `tests/unit/commands/login.test.ts`
  - PKCE `code_verifier` / `code_challenge` generation correctness.
  - `state` mismatch → error, no token written.
  - Timeout (mocked timer) → error, server closed.
  - Successful full flow (HTTP server and `open` mocked).

**Integration tests:** Not in scope for the browser-based login flow.
Token-refresh behaviour can be covered by placing a pre-built token file in
the DDEV test environment.
