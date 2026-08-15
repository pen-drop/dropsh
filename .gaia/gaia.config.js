// @gaia-schema-version 2
// Canonical GAIA CONNECTION config — committed (GAIA-201). A dropsh-shaped
// { site, plugins } read by 'gaia ui', 'gaia dropsh', and this conductor's auth.
// Connection + credentials come from your user-global machine context
// (~/.gaia/machine.config.js). The engine wiring lives in the sibling
// conductor.config.js (engine-only).
//
// plugins[] is consumed by DROPSH, whose resolver has no sole-function
// auto-pick, so @dropsh/plugin-oauth2 entries MUST name export: 'oauth2Plugin'.
// The '@gaia-ai/addon-essentials' entry (GAIA-226) needs NO export: — that
// package default-exports its factory. It contributes the markdown renderer
// ('gaia dropsh --format md') plus the authoritative JSON:API schema.
async function loadMachine() {
  try {
    return (await import(`${process.env.HOME}/.gaia/machine.config.js`)).default ?? {};
  } catch {}
  return {};
}

async function loadLocal() {
  try { return (await import('./conductor.config.local.js')).default ?? {}; } catch {}
  return {};
}

const machine = await loadMachine();
const local = await loadLocal();
const baseUrl = local.base_url ?? machine.base_url;
const clientId = local.oauth?.client_id ?? machine.client_id ?? 'gaia-agent';
const clientSecret = local.oauth?.client_secret ?? machine.client_secret;

export default {
  // GAIA-216: the connection-config schema version — kept in sync with the
  // header marker above so `gaia upgrade` can migrate a stale-shape config.
  schema_version: 2,
  site: { base_url: baseUrl, jsonapi_prefix: local.jsonapi_prefix ?? '/jsonapi' },
  plugins: [
    { plugin: '@gaia-ai/addon-essentials' },
    {
      plugin: '@dropsh/plugin-oauth2',
      export: 'oauth2Plugin',
      with: {
        id: 'session',
        default: true,
        type: 'oauth2_client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        token_url: `${baseUrl}/oauth/token`,
        scope: 'gaia:session',
      },
    },
    {
      plugin: '@dropsh/plugin-oauth2',
      export: 'oauth2Plugin',
      with: {
        id: 'pm',
        type: 'oauth2_client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        token_url: `${baseUrl}/oauth/token`,
        scope: 'gaia:project_manager',
      },
    },
  ],
};
