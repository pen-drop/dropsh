import { oauth2Plugin } from "@drupal-cli/plugin-oauth2";
import { schemataPlugin } from "@drupal-cli/plugin-schemata";

export default {
  site: {
    base_url: "http://drupal-cli-test-schemata-5fdcffda.ddev.site",
    jsonapi_prefix: "/jsonapi",
  },
  plugins: [
    oauth2Plugin({
      type: "oauth2_authcode",
      client_id: "tests-authcode",
      token_url: "http://drupal-cli-test-schemata-5fdcffda.ddev.site/oauth/token",
      scope: "integration:content",
      redirect_port: 7432,
    }),
    schemataPlugin(),
  ],
};
