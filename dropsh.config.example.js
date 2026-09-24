// dropsh.config.example.js — copy to dropsh.config.js and fill in your values.
//
// This file holds only NON-SECRET connection parameters. Secrets (passwords,
// client secrets, tokens) are never stored here — they are prompted by
// `dropsh auth login` and persisted to ~/.config/dropsh/<host>.json (mode 0600).
//
// The same file placed at ~/.config/dropsh/connections/<id>.js is a *named
// connection*, selectable from anywhere as `dropsh --connection <id> …`. That
// directory is overridable with `--connections-dir <path>` or
// $DROPSH_CONNECTIONS_DIR; `dropsh connections list` shows what is available.
import { basicAuthPlugin } from "dropsh";
// import { oauth2Plugin } from '@dropsh/plugin-oauth2';
// import { schemataPlugin } from '@dropsh/plugin-schemata';
// import { markdownPlugin } from '@dropsh/plugin-markdown';
// import { tablePlugin } from '@dropsh/plugin-table';
// import { tuiPlugin } from '@dropsh/plugin-tui';

export default {
  site: {
    base_url: "https://my-drupal.example.com",
    jsonapi_prefix: "/jsonapi",
  },
  defaults: {
    dry_run: false,
    timeout_ms: 30000,
  },
  plugins: [
    // Basic auth: username/password are prompted at `dropsh auth login`.
    basicAuthPlugin(),

    // OAuth2 (requires @dropsh/plugin-oauth2). The client_secret and, for the
    // password grant, the user password are prompted at login — never stored here.
    //
    // Authorization-code (browser PKCE) flow:
    // oauth2Plugin({
    //   type: 'oauth2_authcode',
    //   client_id: 'my-client',
    //   token_url: 'https://my-drupal.example.com/oauth/token',
    //   // scope: 'content',
    //   // redirect_port: 8910,
    // }),
    //
    // Device flow (RFC 8628) — for a remote machine with no local browser:
    // oauth2Plugin({
    //   type: 'oauth2_device_code',
    //   client_id: 'my-client',
    //   device_authorization_url: 'https://my-drupal.example.com/oauth/device_authorization',
    //   token_url: 'https://my-drupal.example.com/oauth/token',
    //   // scope: 'content',
    // }),
    //
    // Password grant:
    // oauth2Plugin({
    //   type: 'oauth2_password',
    //   client_id: 'my-client',
    //   username: 'editor',
    //   token_url: 'https://my-drupal.example.com/oauth/token',
    //   // scope: 'content',
    // }),
    //
    // Client-credentials grant:
    // oauth2Plugin({
    //   type: 'oauth2_client_credentials',
    //   client_id: 'my-client',
    //   token_url: 'https://my-drupal.example.com/oauth/token',
    //   // scope: 'content',
    // }),

    // schemataPlugin(),

    // Render plugins (interactive/alternative output formats):
    // markdownPlugin(),
    // tablePlugin(),
    // Generic list/detail views handle every entity; pass { plugins: [...] }
    // only to register custom TUI sub-plugins (entity views/lists and routes).
    // tuiPlugin(),
  ],
};
