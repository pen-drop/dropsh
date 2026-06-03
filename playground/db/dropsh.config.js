// Display Builder integration: subsite with basic_auth + display_builder + ui_patterns.
// URL: http://db.dropsh-test.ddev.site
//
// The display-builder dropsh plugin is not yet implemented. This config is a
// placeholder; once `plugins/display-builder` lands, add its import here.
import { basicAuthPlugin } from "dropsh/plugin";

export default {
  site: {
    base_url: "http://db.dropsh-test.ddev.site",
    jsonapi_prefix: "/jsonapi",
  },
  plugins: [
    basicAuthPlugin({ username: "tester", password: "tester-pw" }),
    // displayBuilderPlugin(),  // TODO once @dropsh/plugin-display-builder exists
  ],
};
