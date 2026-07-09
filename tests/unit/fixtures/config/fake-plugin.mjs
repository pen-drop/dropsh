// A named plugin package (fixture): a factory that returns a DropSHPlugin.
export function makePlugin(opts = {}) {
  return {
    id: opts.id ?? "fake-named",
    requiredModules: [],
    authProvider: {
      id: opts.id ?? "fake-named",
      displayName: "Fake named plugin",
      capabilities: { login: true, logout: true, status: true },
    },
  };
}

export default makePlugin;
