// A pre-constructed plugin (carries authProvider) must pass through untouched —
// backward compatibility for import-based configs.
export default {
  site: { base_url: "https://example.com" },
  plugins: [
    {
      id: "prebuilt",
      requiredModules: ["simple_oauth"],
      authProvider: {
        id: "prebuilt",
        displayName: "Prebuilt",
        capabilities: { login: true, logout: true, status: true },
      },
    },
  ],
};
