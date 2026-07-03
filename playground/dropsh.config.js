import { markdownPlugin } from "@dropsh/plugin-markdown";
import { oauth2Plugin } from "@dropsh/plugin-oauth2";
import { schemataPlugin } from "@dropsh/plugin-schemata";
import { tablePlugin } from "@dropsh/plugin-table";
import { tuiPlugin } from "@dropsh/plugin-tui";

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
    // Render plugins: enable `--format md`, `--format table`, and `dropsh browse`.
    markdownPlugin(),
    tablePlugin(),
    tuiPlugin({
      defaultPageSize: 25,
      views: [
        {
          entityType: "node",
          bundle: "article_test",
          columns: ["title", "status"],
          filters: { status: "1" },
        },
      ],
    }),
  ],
};
