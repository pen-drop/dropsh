// Canvas integration: subsite with basic_auth + canvas + jsonapi_sdc.
// URL: http://canvas.dropsh-test.ddev.site
import { basicAuthPlugin } from "dropsh/plugin";
import { canvasPlugin } from "@dropsh/plugin-canvas";

export default {
  site: {
    base_url: "http://canvas.dropsh-test.ddev.site",
    jsonapi_prefix: "/jsonapi",
  },
  plugins: [
    basicAuthPlugin({ username: "tester", password: "tester-pw" }),
    canvasPlugin(),
  ],
};
