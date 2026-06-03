# @dropsh/plugin-oauth2

OAuth 2.0 authentication provider for [dropsh](https://github.com/pen-drop/dropsh),
the entity-agnostic CLI for Drupal 11 JSON:API.

Adds an OAuth2 login option to `dropsh auth login`. Supports three grant types
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

## Grant types

| `type`                        | Interactive login prompts        | Token refresh        |
| ----------------------------- | -------------------------------- | -------------------- |
| `oauth2_authcode`             | opens browser (PKCE, public client) | yes (refresh token) |
| `oauth2_password`             | client secret + user password    | re-login on expiry   |
| `oauth2_client_credentials`   | client secret                     | re-login on expiry   |

Config fields per grant:

- `oauth2_authcode` — `client_id`, `token_url`, optional `scope`, `redirect_port`
- `oauth2_password` — `client_id`, `token_url`, `username`, optional `scope`
- `oauth2_client_credentials` — `client_id`, `token_url`, optional `scope`

`client_secret` and the user `password` are **prompted at login**, never stored
in config.

## Required Drupal module

- [`simple_oauth`](https://www.drupal.org/project/simple_oauth)

## License

MIT OR GPL-2.0-or-later
