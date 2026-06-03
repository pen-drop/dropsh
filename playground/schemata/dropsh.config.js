// Schemata integration: subsite with basic_auth + schemata + schemata_json_schema.
// No simple_oauth here — Basic Auth is the default.
// URL: http://schemata.dropsh-test.ddev.site
import { basicAuthPlugin } from "dropsh/plugin";
import { schemataPlugin } from "@dropsh/plugin-schemata";

export default {
  site: {
    base_url: "http://schemata.dropsh-test.ddev.site",
    jsonapi_prefix: "/jsonapi",
  },
  plugins: [
    basicAuthPlugin({ username: "tester", password: "tester-pw" }),
    schemataPlugin(),
  ],
};
