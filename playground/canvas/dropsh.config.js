// Canvas integration: subsite with simple_oauth (authcode + PKCE) + canvas + jsonapi_sdc.
// URL: http://canvas.dropsh-test.ddev.site
// Run `npx dropsh auth login` once to authenticate via browser.
import { oauth2Plugin } from "@dropsh/plugin-oauth2";
import { canvasPlugin } from "@dropsh/plugin-canvas";

export default {
  site: {
    base_url: "http://canvas.dropsh-test.ddev.site",
    jsonapi_prefix: "/jsonapi",
  },
  plugins: [
    oauth2Plugin({
      type: "oauth2_authcode",
      client_id: "tests-authcode",
      token_url: "http://canvas.dropsh-test.ddev.site/oauth/token",
      scope: "integration:content",
    }),
    canvasPlugin(),
  ],
};
