# Request Alteration Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an ordered `alterRequest` plugin hook that receives dropsh request context, runs once after initial authentication, and preserves its result across a 401 renewal retry.

**Architecture:** The JSON:API client owns request classification and a generic optional alteration callback. `defaultContext()` adapts configured plugins into that callback through a focused internal composer, keeping the client independent of `DropSHPlugin`. The first attempt is authenticated and then altered; a 401 retry reapplies renewed auth to the already altered request without rerunning plugins.

**Tech Stack:** TypeScript 5, Node.js 20+, Vitest, Biome, pnpm workspace, Drupal JSON:API, DDEV integration environment.

## Global Constraints

- The public hook name is `alterRequest`, not `transformRequest` or `extendRequest`.
- `alterRequest(req, ctx)` returns `Promise<HttpRequest>` and is optional.
- `RequestContext` extends `PluginContext` with `operation`, optional `entityType`, and optional `bundle`.
- `DropSHOperation` is exactly `"read" | "search" | "create" | "update" | "delete" | "upload"`.
- GET and DELETE remain bodyless; JSON writes keep string bodies; uploads keep binary bodies.
- Hooks run once, in configured plugin order, after auth and before the first HTTP send.
- A first-attempt hook may alter every field, including `Authorization`.
- A 401 retry reapplies renewed auth to the already altered request and does not rerun hooks.
- Hook failures and invalid `undefined` results become `PluginError` (`E_PLUGIN`, exit code `6`) before any HTTP send.
- Existing plugins and configurations require no changes.
- Do not add a response hook or alter non-JSON:API request paths.

---

## File Structure

- Modify `src/core/jsonapi/client.ts`: define request operations, classify request targets, expose the generic alteration callback, and enforce first-attempt/retry ordering.
- Modify `src/core/plugin.ts`: add `RequestContext` and `DropSHPlugin.alterRequest` to the public plugin contract.
- Create `src/core/request-hooks.ts`: compose configured plugin hooks, create request-specific contexts, validate results, and wrap failures.
- Modify `src/index.ts`: build the stable plugin context and pass the composed callback to `createJsonApiClient()`.
- Modify `src/errors.ts`: add and map `PluginError`.
- Modify `src/plugin-api.ts`: export the new public context, operation, and error types/classes.
- Modify `tests/unit/core/jsonapi/client.test.ts`: cover operation metadata, bodies, auth order, no-op behavior, and 401 semantics at the HTTP boundary.
- Create `tests/unit/core/request-hooks.test.ts`: cover plugin order, context construction, legacy plugins, thrown errors, and invalid returns.
- Modify `tests/unit/core/plugin.test.ts`: type-check the new optional method and context.
- Modify `tests/unit/errors.test.ts`: cover `PluginError` fields and exit code.
- Modify `tests/unit/package-types.test.ts`: assert the public plugin entry point contains the new declarations after build.

---

### Task 1: Public types and named plugin error

**Files:**
- Modify: `src/core/jsonapi/client.ts`
- Modify: `src/core/plugin.ts`
- Modify: `src/errors.ts`
- Modify: `src/plugin-api.ts`
- Test: `tests/unit/core/plugin.test.ts`
- Test: `tests/unit/errors.test.ts`
- Test: `tests/unit/package-types.test.ts`

**Interfaces:**
- Produces: `DropSHOperation` union from `src/core/jsonapi/client.ts`.
- Produces: `RequestContext extends PluginContext` with `operation`, `entityType?`, and `bundle?`.
- Produces: `DropSHPlugin.alterRequest?(req: HttpRequest, ctx: RequestContext): Promise<HttpRequest>`.
- Produces: `PluginError(pluginId: string, hook: string, cause: unknown)` with code `E_PLUGIN` and exit code `6`.
- Produces: public exports through `dropsh/plugin`.

- [ ] **Step 1: Write failing public-contract and error tests**

Add a typed plugin case to `tests/unit/core/plugin.test.ts`:

```ts
it("accepts an async alterRequest hook with request context", async () => {
  const plugin: DropSHPlugin = {
    id: "tenant",
    requiredModules: [],
    async alterRequest(req, requestCtx) {
      expect(requestCtx.operation).toBe("create");
      expect(requestCtx.entityType).toBe("gaia_ticket");
      expect(requestCtx.bundle).toBe("gaia_ticket");
      return { ...req, headers: { ...req.headers, "X-Plugin": plugin.id } };
    },
  };

  const altered = await plugin.alterRequest?.(
    { method: "POST", url: "https://example.com/jsonapi/gaia_ticket/gaia_ticket" },
    {
      ...ctx,
      operation: "create",
      entityType: "gaia_ticket",
      bundle: "gaia_ticket",
    },
  );

  expect(altered?.headers?.["X-Plugin"]).toBe("tenant");
});
```

Add `PluginError` coverage to `tests/unit/errors.test.ts`:

```ts
it("PluginError identifies the plugin and hook", () => {
  const err = new PluginError("tenant", "alterRequest", new Error("boom"));
  expect(err.name).toBe("PluginError");
  expect(err.code).toBe("E_PLUGIN");
  expect(err.message).toContain("tenant");
  expect(err.details).toMatchObject({ pluginId: "tenant", hook: "alterRequest" });
  expect(exitCodeFor(err)).toBe(6);
});
```

Import the new types from the public barrel at the top of
`tests/unit/package-types.test.ts` so TypeScript verifies that consumers do not
need an internal import:

```ts
import { PluginError } from "../../src/plugin-api.js";
import type {
  DropSHOperation,
  DropSHPlugin,
  RequestContext,
} from "../../src/plugin-api.js";

it("exports request alteration plugin types", () => {
  const operation: DropSHOperation = "create";
  const acceptsContext = (_ctx: RequestContext): void => {};
  const acceptsPlugin = (_plugin: DropSHPlugin): void => {};
  expect(operation).toBe("create");
  expect(acceptsContext).toBeTypeOf("function");
  expect(acceptsPlugin).toBeTypeOf("function");
  expect(new PluginError("tenant", "alterRequest", "boom").code).toBe("E_PLUGIN");
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
pnpm vitest run tests/unit/core/plugin.test.ts tests/unit/errors.test.ts tests/unit/package-types.test.ts
```

Expected: FAIL because `alterRequest`, `RequestContext`, `DropSHOperation`, and `PluginError` do not exist.

- [ ] **Step 3: Add the operation, context, hook, and error types**

In `src/core/jsonapi/client.ts`, export:

```ts
export type DropSHOperation = "read" | "search" | "create" | "update" | "delete" | "upload";
```

In `src/core/plugin.ts`, import `HttpRequest` and `DropSHOperation` as types, then add:

```ts
export interface RequestContext extends PluginContext {
  operation: DropSHOperation;
  entityType?: string;
  bundle?: string;
}
```

Add to `DropSHPlugin`:

```ts
alterRequest?(req: HttpRequest, ctx: RequestContext): Promise<HttpRequest>;
```

In `src/errors.ts`, add:

```ts
export class PluginError extends CliError {
  constructor(pluginId: string, hook: string, cause: unknown) {
    super("E_PLUGIN", `plugin '${pluginId}' failed in ${hook}`, {
      pluginId,
      hook,
      cause: String(cause),
    });
    this.name = "PluginError";
  }
}
```

Add `if (err instanceof PluginError) return 6;` to `exitCodeFor()` after the existing specific error checks. Export `PluginError`, `DropSHOperation`, and `RequestContext` from `src/plugin-api.ts`.

- [ ] **Step 4: Build declarations and run focused tests for GREEN**

Run:

```bash
pnpm run build
pnpm vitest run tests/unit/core/plugin.test.ts tests/unit/errors.test.ts tests/unit/package-types.test.ts
```

Expected: PASS; the test compiles while importing every new symbol through
`src/plugin-api.ts`, the source of the published `dropsh/plugin` entry point.

- [ ] **Step 5: Commit the public contract**

```bash
git add src/core/jsonapi/client.ts src/core/plugin.ts src/errors.ts src/plugin-api.ts tests/unit/core/plugin.test.ts tests/unit/errors.test.ts tests/unit/package-types.test.ts
git commit -m "feat(plugin): add request alteration contract"
```

---

### Task 2: JSON:API request classification and execution order

**Files:**
- Modify: `src/core/jsonapi/client.ts`
- Test: `tests/unit/core/jsonapi/client.test.ts`

**Interfaces:**
- Consumes: `DropSHOperation` from Task 1.
- Produces: optional `JsonApiOptions.alterRequest(req, operation, entityType?, bundle?): Promise<HttpRequest>`.
- Guarantees: initial order `auth.apply -> alterRequest -> http.send`.
- Guarantees: retry order `auth.renew -> auth.apply(alteredRequest) -> http.send`, without another alteration.

- [ ] **Step 1: Write failing request-context tests for all operations**

Create a table-driven test in `tests/unit/core/jsonapi/client.test.ts` that supplies an `alterRequest` spy, invokes each client method, and asserts these tuples:

```ts
[
  ["read", "node", "article", "GET", undefined],
  ["search", "node", "article", "GET", undefined],
  ["create", "node", "article", "POST", '{"data":{}}'],
  ["update", "node", "article", "PATCH", '{"data":{}}'],
  ["delete", "node", "article", "DELETE", undefined],
  ["upload", "node", "article", "POST", expect.any(Uint8Array)],
]
```

Use an item path (`node/article/u1`) for `read`, a collection path (`node/article`) for `search`, and `node/article/u1/field_image` for upload. Add a separate `me()` assertion for `operation === "read"` with both target values absent.

- [ ] **Step 2: Write failing auth-order and no-op tests**

Add a test whose auth adapter writes `Authorization: Bearer original`, whose hook asserts that value and returns `Authorization: Plugin replacement`, and whose fake HTTP client asserts the replacement. Verify `auth.apply`, alteration, and send occur in that order.

Add a no-op comparison test that captures one request with no callback and one with `alterRequest: async (req) => req`, then asserts:

```ts
expect(withHook).toEqual(withoutHook);
expect(withHook.body).toBe(withoutHook.body);
```

- [ ] **Step 3: Write the failing one-time 401 retry test**

Record both HTTP attempts and use spies for auth and alteration. The first send throws `new HttpError(401, "HTTP 401")`; renewal changes the token from `stale` to `fresh`; the second send succeeds. Assert:

```ts
expect(alterRequest).toHaveBeenCalledOnce();
expect(calls).toHaveLength(2);
expect(calls[0]?.body).toBe('{"data":{"marker":"altered"}}');
expect(calls[1]?.body).toBe(calls[0]?.body);
expect(calls[0]?.headers?.Authorization).toBe("Plugin replacement");
expect(calls[1]?.headers?.Authorization).toBe("Bearer fresh");
```

- [ ] **Step 4: Run the focused client tests and confirm RED**

Run:

```bash
pnpm vitest run tests/unit/core/jsonapi/client.test.ts
```

Expected: FAIL because `JsonApiOptions` has no alteration callback and the current client authenticates immediately before both sends.

- [ ] **Step 5: Implement classification and the first-attempt pipeline**

Add the callback to `JsonApiOptions`:

```ts
alterRequest?: (
  req: HttpRequest,
  operation: DropSHOperation,
  entityType?: string,
  bundle?: string,
) => Promise<HttpRequest>;
```

Add focused helpers:

```ts
function targetFromPath(path: string): { entityType?: string; bundle?: string } {
  const [entityType, bundle] = path.split("/").filter(Boolean);
  return {
    ...(entityType !== undefined ? { entityType } : {}),
    ...(bundle !== undefined ? { bundle } : {}),
  };
}

function getOperation(path: string): DropSHOperation {
  const segments = path.split("/").filter(Boolean);
  return segments.length === 0 || segments.length >= 3 ? "read" : "search";
}
```

Refactor the private `send()` to accept `operation` and the unqueried resource `path`, construct the URL internally, authenticate the base request, invoke `opts.alterRequest` once when present, and store the result as `alteredRequest` before the first `http.send()`.

Map client methods explicitly:

```ts
get    -> getOperation(path)
post   -> "create"
patch  -> "update"
delete -> "delete"
upload -> "upload"
```

On 401, call `auth.renew()`, then `auth.apply(alteredRequest)`, and send that result directly. Never call `alterRequest` in the catch/retry branch.

- [ ] **Step 6: Run focused client tests for GREEN**

Run:

```bash
pnpm vitest run tests/unit/core/jsonapi/client.test.ts
```

Expected: PASS, including the existing URL, upload, ergonomic client, and auth tests.

- [ ] **Step 7: Commit the JSON:API pipeline**

```bash
git add src/core/jsonapi/client.ts tests/unit/core/jsonapi/client.test.ts
git commit -m "feat(jsonapi): alter authenticated requests before send"
```

---

### Task 3: Compose plugin hooks and wire default configuration

**Files:**
- Create: `src/core/request-hooks.ts`
- Modify: `src/index.ts`
- Test: `tests/unit/core/request-hooks.test.ts`

**Interfaces:**
- Consumes: `DropSHPlugin`, `PluginContext`, `RequestContext`, `DropSHOperation`, `PluginError`, and Task 2's `JsonApiOptions.alterRequest` shape.
- Produces: `composeRequestHooks(plugins: DropSHPlugin[], ctx: PluginContext)` returning a callback compatible with `JsonApiOptions.alterRequest`.
- Guarantees: plugin order, previous-result chaining, per-request context, legacy no-op behavior, runtime result validation, and named failures.

- [ ] **Step 1: Write failing composer ordering and context tests**

Create `tests/unit/core/request-hooks.test.ts`. Build two plugins whose hooks append `A` and `B` to an `X-Order` header. Invoke the composed callback with `("create", "gaia_ticket", "gaia_ticket")` and assert:

```ts
expect(result.headers?.["X-Order"]).toBe("AB");
expect(seenContexts).toEqual([
  expect.objectContaining({
    operation: "create",
    entityType: "gaia_ticket",
    bundle: "gaia_ticket",
    baseUrl: "https://example.com",
  }),
  expect.objectContaining({
    operation: "create",
    entityType: "gaia_ticket",
    bundle: "gaia_ticket",
    baseUrl: "https://example.com",
  }),
]);
```

Also assert that a list containing only plugins without `alterRequest` returns the exact same request object.

- [ ] **Step 2: Write failing composer error tests**

Add one plugin that throws `new Error("boom")`. Assert rejection matches:

```ts
await expect(alter(req, "create", "node", "article")).rejects.toMatchObject({
  name: "PluginError",
  code: "E_PLUGIN",
  details: { pluginId: "broken", hook: "alterRequest" },
});
```

Add an untyped JavaScript-style plugin cast that returns `undefined`; assert the same named error and confirm a following plugin was never called.

- [ ] **Step 3: Run composer tests and confirm RED**

Run:

```bash
pnpm vitest run tests/unit/core/request-hooks.test.ts
```

Expected: FAIL because `src/core/request-hooks.ts` does not exist.

- [ ] **Step 4: Implement the focused composer**

Create `src/core/request-hooks.ts` with:

```ts
export function composeRequestHooks(plugins: DropSHPlugin[], ctx: PluginContext) {
  return async (
    req: HttpRequest,
    operation: DropSHOperation,
    entityType?: string,
    bundle?: string,
  ): Promise<HttpRequest> => {
    const requestContext: RequestContext = {
      ...ctx,
      operation,
      ...(entityType !== undefined ? { entityType } : {}),
      ...(bundle !== undefined ? { bundle } : {}),
    };

    let current = req;
    for (const plugin of plugins) {
      if (!plugin.alterRequest) continue;
      try {
        const next = await plugin.alterRequest(current, requestContext);
        if (next === undefined) throw new Error("alterRequest must return an HttpRequest");
        current = next;
      } catch (cause) {
        throw new PluginError(plugin.id, "alterRequest", cause);
      }
    }
    return current;
  };
}
```

Do not export this internal composer from `src/plugin-api.ts`.

- [ ] **Step 5: Wire the composer in `defaultContext()`**

In `src/index.ts`, after resolving `auth`, create the stable context without the client:

```ts
const pluginContext: PluginContext = {
  http,
  auth,
  baseUrl: cfg.site.base_url,
  jsonapiPrefix: cfg.site.jsonapi_prefix,
};
```

Pass `alterRequest: composeRequestHooks(cfg.plugins, pluginContext)` to `createJsonApiClient()`. Continue returning the existing `CommandContext` unchanged. This is the only configuration wiring point.

- [ ] **Step 6: Run composer and relevant integration-style unit tests for GREEN**

Run:

```bash
pnpm vitest run tests/unit/core/request-hooks.test.ts tests/unit/core/jsonapi/client.test.ts tests/unit/plugins-integration.test.ts tests/unit/index.test.ts
```

Expected: PASS; existing plugins without hooks remain unaffected.

- [ ] **Step 7: Commit composition and wiring**

```bash
git add src/core/request-hooks.ts src/index.ts tests/unit/core/request-hooks.test.ts
git commit -m "feat(plugin): compose outgoing request hooks"
```

---

### Task 4: Full verification and integration gate

**Files:**
- Verify only; modify implementation or tests only to fix failures attributable to DROPSH-16.

**Interfaces:**
- Consumes: all behavior and tests from Tasks 1-3.
- Produces: a green repository validation and recorded coding-handoff evidence.

- [ ] **Step 1: Run formatting and static checks**

Run:

```bash
pnpm run lint
pnpm run typecheck
```

Expected: both exit `0`. Existing lint warnings may remain, but DROPSH-16 adds no new warning or error.

- [ ] **Step 2: Run the complete unit suite**

Run:

```bash
pnpm test
```

Expected: all root Vitest files pass, including operation, ordering, auth, retry, no-op, error, and public-type cases.

- [ ] **Step 3: Provision Drupal and run the integration suite**

Run exactly:

```bash
pnpm run drupal:up && pnpm run test:integration && pnpm run drupal:down
```

Expected: provisioning succeeds, all JSON:API/auth/schema/upload integration tests pass, and DDEV is torn down.

If provisioning succeeds but a test fails, run `pnpm run drupal:down` before investigating so the environment is not left running.

- [ ] **Step 4: Review the final diff against the specification**

Run:

```bash
git diff origin/next...HEAD --check
git diff --stat origin/next...HEAD
git status --short
```

Expected: no whitespace errors, only the scoped source/tests/spec/plan files, and a clean worktree.

- [ ] **Step 5: Record verification evidence**

In the coding handoff, record each command, exit status, test counts, the DDEV integration result, and the exact commit SHAs. Do not claim a check that was not run.
