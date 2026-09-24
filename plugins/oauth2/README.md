# @dropsh/plugin-oauth2

OAuth 2.0 authentication provider for [dropsh](https://github.com/pen-drop/dropsh),
the entity-agnostic CLI for Drupal 11 JSON:API.

Adds an OAuth2 login option to `dropsh auth login`. Supports four grant types
against Drupal's `simple_oauth` module.

## Install

```bash
pnpm add @dropsh/plugin-oauth2
```

`dropsh` is a peer dependency.

## Usage

Register the plugin in `dropsh.config.js` with **non-secret** connection
parameters only. Secrets (client secret, user password) and tokens are prompted
at login and stored at `~/.config/dropsh/<host>.json` (mode `0600`) — never in
the config file.

```js
import { oauth2Plugin } from "@dropsh/plugin-oauth2";

export default {
  site: { base_url: "https://my-drupal.example.com", jsonapi_prefix: "/jsonapi" },
  plugins: [
    // Browser login (Authorization Code + PKCE) — recommended for humans:
    oauth2Plugin({
      type: "oauth2_authcode",
      client_id: "my-client",
      token_url: "https://my-drupal.example.com/oauth/token",
      // scope: "...", redirect_port: 7432,
    }),
  ],
};
```

Then:

```bash
dropsh auth login --provider oauth2_authcode
dropsh auth status
```

### Device flow (remote machine, no local browser)

Use `oauth2_device_code` when dropsh runs where your browser is not — over SSH, in a container, on
a build host. There is no callback listener, no redirect URI and no client secret: dropsh prints a
URL and a short code, you confirm the login on any other device, and dropsh polls until it is done.

```js
oauth2Plugin({
  type: "oauth2_device_code",
  client_id: "my-client",
  device_authorization_url: "https://my-drupal.example.com/oauth/device_authorization",
  token_url: "https://my-drupal.example.com/oauth/token",
  // scope: "content",
}),
```

```bash
dropsh auth login --provider oauth2_device_code

Open https://my-drupal.example.com/oauth/device
and enter this code:

    ABCD-EFGH

Waiting for confirmation ...
```

dropsh never opens a browser for this flow, so the URL and the code stay on screen for use on
another device. Press Ctrl+C to cancel. The stored tokens behave like any other profile —
`dropsh auth status`, `dropsh auth logout` and the automatic refresh all work unchanged. If the
server issues no `refresh_token` for the device grant, an expired session asks for a full login
again instead of renewing.

## Named profiles

Every `oauth2Plugin` is one auth **profile**, identified by its `id`. `id` defaults
to the grant `type`, but set it explicitly to run several profiles of the same
grant flow side by side (e.g. two `client_credentials` with different scopes).
Mark one profile `default: true` to make it the fallback when none is selected.

```js
oauth2Plugin({ id: "session", default: true, type: "oauth2_client_credentials",
  client_id: "my-client", client_secret, token_url, scope: "some:scope" }),
oauth2Plugin({ id: "pm", type: "oauth2_client_credentials",
  client_id: "my-client", client_secret, token_url, scope: "other:scope" }),
```

See the [dropsh README](../../README.md#named-profiles--many-identities-per-host)
for `auth use`, `--auth-profile`, and selection precedence.

## Grant types

| `type`                        | Interactive login prompts        | Auto-renew (proactive + on 401) |
| ----------------------------- | -------------------------------- | ------------------------------- |
| `oauth2_authcode`             | opens browser (PKCE, public client) | yes — via `refresh_token`     |
| `oauth2_password`             | client secret + user password    | yes — if `client_secret` in config |
| `oauth2_client_credentials`   | client secret                     | yes — if `client_secret` in config |
| `oauth2_device_code`          | prints a URL + code, no browser  | yes — via `refresh_token`       |

Config fields per grant (all accept the shared `id` and `default`):

- `oauth2_authcode` — `client_id`, `token_url`, optional `scope`, `redirect_port`
- `oauth2_password` — `client_id`, `token_url`, `username`, optional `scope`, `client_secret`
- `oauth2_client_credentials` — `client_id`, `token_url`, optional `scope`, `client_secret`
- `oauth2_device_code` — `client_id`, `device_authorization_url`, `token_url`, optional `scope`

`client_secret` and the user `password` may be **prompted at login** and are never
stored on disk. For unattended runs, put `client_secret` in config so dropsh can
re-mint tokens automatically; a purely prompted secret cannot be renewed and needs
a fresh `dropsh auth login` when the token expires.

## Required Drupal module

- [`simple_oauth`](https://www.drupal.org/project/simple_oauth)

## License

MIT OR GPL-2.0-or-later
