// Display Builder integration: subsite with simple_oauth (authcode + PKCE) + display_builder.
// URL: http://db.dropsh-test.ddev.site
// Run `npx dropsh auth login` once to authenticate via browser.
import { displayBuilderPlugin } from "@dropsh/plugin-display-builder";
import { oauth2Plugin } from "@dropsh/plugin-oauth2";

export default {
  site: {
    base_url: "http://db.dropsh-test.ddev.site",
    jsonapi_prefix: "/jsonapi",
  },
  plugins: [
    oauth2Plugin({
      type: "oauth2_authcode",
      client_id: "tests-authcode",
      token_url: "http://db.dropsh-test.ddev.site/oauth/token",
      scope: "integration:content",
    }),
    displayBuilderPlugin(),
  ],
};
