// Schemata integration: subsite with basic_auth + schemata + schemata_json_schema.
// URL: http://schemata.__DDEV_PROJECT__.ddev.site
//
// Auth is OAuth Bearer, not Basic: the /schemata/* routes do not opt into
// basic_auth, so a Basic header is ignored there, the request is treated as
// anonymous, and the 403 error page cannot be serialised as `schema_json` —
// which surfaces as a 500 and a silent fall back to the heuristic schema. The
// password grant is used so the playground needs no browser round-trip; this
// mirrors `tests/integrations/helpers/config.ts`, where the same site sets
// `defaultAuth: "oauth2_password"` for exactly this reason.
import { oauth2Plugin } from "@dropsh/plugin-oauth2";
import { schemataPlugin } from "@dropsh/plugin-schemata";

export default {
  site: {
    base_url: "http://schemata.__DDEV_PROJECT__.ddev.site",
    jsonapi_prefix: "/jsonapi",
  },
  plugins: [
    oauth2Plugin({
      type: "oauth2_password",
      client_id: "tests-password",
      client_secret: "tests-password-secret",
      username: "tester",
      token_url: "http://schemata.__DDEV_PROJECT__.ddev.site/oauth/token",
      scope: "integration:content",
    }),
    schemataPlugin(),
  ],
};
