// drupal-cli.config.example.js — copy to drupal-cli.config.js and fill in your values
// import { oauth2Plugin } from '@drupal-cli/plugin-oauth2';
// import { schemataPlugin } from '@drupal-cli/plugin-schemata';

export default {
  site: {
    base_url: 'https://my-drupal.example.com',
    jsonapi_prefix: '/jsonapi',
    auth: {
      // Basic auth (no plugin needed):
      type: 'basic',
      username: process.env.DRUPAL_USER,
      password: process.env.DRUPAL_PASSWORD,

      // OAuth2 password grant (requires @drupal-cli/plugin-oauth2):
      // type: 'oauth2_password',
      // client_id: process.env.DRUPAL_CLIENT_ID,
      // client_secret: process.env.DRUPAL_CLIENT_SECRET,
      // username: process.env.DRUPAL_USER,
      // password: process.env.DRUPAL_PASSWORD,
    },
  },
  defaults: {
    dry_run: false,
    timeout_ms: 30000,
  },
  plugins: [
    // oauth2Plugin(),
    // schemataPlugin(),
  ],
};
