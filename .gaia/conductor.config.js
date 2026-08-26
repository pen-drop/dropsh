// Canonical GAIA conductor config — committed. Connection + identity come from
// your user-global machine context (~/.config/conductor/conductor.config.machine.js:
// { machine_id, user_id, base_url, client_id, client_secret }); machine_id is
// composed here as `${user_id}-${machine_id}-${project}`. `project` is the only
// per-repo value and is baked in below. The client_secret is read from the
// machine context (gitignored, user-only) — never committed here.
//
// IMPORT-FREE (GAIA-78): the plugin slots + plugins[] are `{ plugin, with }`
// descriptors naming the REAL published package (`@gaia-ai/plugin-*`,
// `@dropsh/plugin-*`), not `import`ed constructors. loadConductorConfig
// resolves each name ESLint-style (config dir → cwd → conductor install), so
// config load never depends on a `node_modules/@gaia-ai` symlink beside this
// file. Each plugin package default-exports its factory, so the resolver's
// auto-pick needs no `export:` here — only the `@gaia-ai/gaia/plugins` host
// barrel (many exports) still names one via `export: 'drupalRemote'`.

// The user-global machine context: identity + connection (incl. secret), shared
// by every project on this machine. Never committed.
async function loadMachine() {
  try {
    return (await import(`${process.env.HOME}/.config/conductor/conductor.config.machine.js`)).default ?? {};
  } catch {}
  return {};
}

// OPTIONAL per-project override — create conductor.config.local.js beside this
// file to override any field (machine_id, base_url, model, …). It is loaded only
// if present and is NOT created by `gaia conductor init`.
async function loadLocal() {
  try { return (await import('./conductor.config.local.js')).default ?? {}; } catch {}
  return {};
}

const machine = await loadMachine();
const local = await loadLocal();
const project = local.project ?? 'dropsh';
const composedMachineId =
  machine.user_id && machine.machine_id
    ? `${machine.user_id}-${machine.machine_id}-${project}`
    : undefined;

export default {
  project,
  machine_id: local.machine_id ?? composedMachineId,
  max_parallel: 5,
  remote: { plugin: '@gaia-ai/addon-remote-drupal' },
  // No hard-wired diff pane for review: the review diff surface is hunk
  // (GAIA-55) — agent-driven + opt-in in the human's interactive pane, not an
  // executor-forced git-diff pane. Clicking a changed file in that hunk pane
  // opens it editable in a spiceedit overlay (see conductor/README.md).
  executor: { plugin: '@gaia-ai/addon-herdr' },
  // Agent selection by static ticket assessment (GAIA-144): `agent` may be an
  // array of `{ agent, priority?(ticket) }` candidates. The conductor calls each
  // priority(ticket) at dispatch (ticket carries sideloaded `labels` +
  // `environments`), sorts highest-first, and runs the top one; a candidate with
  // no `priority` scores -Infinity. Here: codex and grok win ONLY when the ticket
  // carries the matching label; claude is the default (baseline priority 0) for
  // everything else.
  agent: [
    {
      agent: { plugin: '@gaia-ai/addon-codex' },
      priority: (ticket) =>
        ticket.labels?.includes('codex') ? 100 : Number.NEGATIVE_INFINITY,
    },
    {
      agent: { plugin: '@gaia-ai/addon-grok', with: { model: 'grok-4.5' } },
      priority: (ticket) =>
        ticket.labels?.includes('grok') ? 100 : Number.NEGATIVE_INFINITY,
    },
    {
      agent: {
        plugin: '@gaia-ai/addon-claude',
        with: { model: local.model ?? 'claude-opus-5' },
      },
      priority: () => 0,
    },
  ],
  // dropsh is a Node CLI, not a Drupal app — no per-worktree DDEV. A fresh git
  // worktree shares .git but not node_modules, so after_create only installs
  // deps. The integration-test target is the shared `dropsh-test` DDEV
  // multisite, provisioned once on the host via `pnpm run drupal:up` (NOT per
  // worktree); tests reach it over HTTP at the static *.dropsh-test.ddev.site
  // URLs baked into tests/integrations/helpers/config.ts. No after_done: there
  // is no per-worktree environment to reclaim.
  workspace: {
    plugin: '@gaia-ai/addon-herdr',
    export: 'herdrWorkspace',
    with: {
      hooks: { after_create: 'pnpm install' },
    },
  },
};
