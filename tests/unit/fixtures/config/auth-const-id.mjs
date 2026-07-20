// Models an auth plugin (the shape @dropsh/plugin-oauth2 had before DROPSH-12)
// whose `plugin.id` is CONSTANT across instances while its `authProvider.id`
// varies by options. This is exactly the shape that exposed the emit-dedup bug:
// two distinct-config entries were collapsed by `plugin.id` before the auth
// registry could see the second provider.
export function makeAuth(opts = {}) {
  return {
    id: "authconst",
    requiredModules: [],
    authProvider: {
      id: opts.id,
      displayName: `auth[${opts.id}]`,
      default: opts.default === true,
      capabilities: { login: true, logout: true, status: true },
    },
  };
}
export default makeAuth;
