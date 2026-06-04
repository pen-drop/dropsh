import { displayBuilderPlugin } from "@dropsh/plugin-display-builder";
import { basicAuthPlugin } from "dropsh/plugin";

export default {
  site: {
    base_url: "http://db.dropsh-test.ddev.site",
    jsonapi_prefix: "/jsonapi",
  },
  plugins: [
    basicAuthPlugin({ username: "tester", password: "tester-pw" }),
    displayBuilderPlugin(),
  ],
};
