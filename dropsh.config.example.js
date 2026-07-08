// dropsh.config.example.js — copy to dropsh.config.js and fill in your values.
//
// This file holds only NON-SECRET connection parameters. Secrets (passwords,
// client secrets, tokens) are never stored here — they are prompted by
// `dropsh auth login` and persisted to ~/.config/dropsh/<host>.json (mode 0600).
import { basicAuthPlugin } from 'dropsh';
// import { oauth2Plugin } from '@dropsh/plugin-oauth2';
// import { jsonapiSchemaPlugin } from '@dropsh/plugin-jsonapi-schema';
// import { schemataPlugin } from '@dropsh/plugin-schemata';

export default {
  site: {
    base_url: 'https://my-drupal.example.com',
    jsonapi_prefix: '/jsonapi',
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

    // Authoritative, constraint-bearing write schema (recommended). Backed by
    // the jsonapi_schema Drupal module — works on Drupal 10.1+/11 + PHP 8.4.
    // Requires @dropsh/plugin-jsonapi-schema and `drush en jsonapi_schema`.
    // jsonapiSchemaPlugin(),

    // Legacy alternative backed by the schemata module. NOTE: its endpoint
    // returns HTTP 500 on Drupal 11 / PHP 8.4 — prefer jsonapiSchemaPlugin()
    // there. Requires @dropsh/plugin-schemata.
    // schemataPlugin(),
  ],
};
