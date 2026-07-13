import { markdownPlugin } from "@dropsh/plugin-markdown";
import { oauth2Plugin } from "@dropsh/plugin-oauth2";
import { schemataPlugin } from "@dropsh/plugin-schemata";
import { tablePlugin } from "@dropsh/plugin-table";
import { tuiPlugin } from "@dropsh/plugin-tui";

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
    schemataPlugin(),
    // Render plugins: enable `--format md`, `--format table`, and `--format tui`.
    markdownPlugin(),
    tablePlugin(),
    // Generic list/detail views handle every entity out of the box. Pass
    // `{ plugins: [...] }` only to register custom TUI sub-plugins (entity
    // views/lists and routes); see @dropsh/plugin-tui `TuiOptions`.
    tuiPlugin(),
  ],
};
