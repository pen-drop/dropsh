// Plain integration: base Drupal site with basic_auth + simple_oauth.
// URL: http://__DDEV_PROJECT__.ddev.site
import { oauth2Plugin } from "@dropsh/plugin-oauth2";

export default {
  site: {
    base_url: "http://__DDEV_PROJECT__.ddev.site",
    jsonapi_prefix: "/jsonapi",
  },
  plugins: [
    oauth2Plugin({
      type: "oauth2_authcode",
      client_id: "tests-authcode",
      token_url: "http://__DDEV_PROJECT__.ddev.site/oauth/token",
      scope: "integration:content",
      redirect_port: 7432,
    }),
  ],
};
