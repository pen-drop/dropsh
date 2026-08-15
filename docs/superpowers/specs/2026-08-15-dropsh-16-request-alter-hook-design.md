# Request alteration hook (DROPSH-16)

## Problem

A dropsh plugin cannot alter an outgoing JSON:API request. GAIA needs a plugin
that adds the active `workspace_id` relationship to JSON:API creates without
requiring every caller to add it explicitly.

The existing plugin extension points operate on authentication, schemas,
commands, and renderers. Only the JSON:API client sees the complete outgoing
request. Using an authentication provider as a request wrapper would replace
the configured provider and couple the tenant plugin to authentication details.

## Goals

- Add an optional request hook to the public plugin API.
- Give the hook the dropsh operation, entity type, bundle, and complete HTTP
  request.
- Apply multiple hooks in configured plugin order.
- Make the hook the final extensibility callback before the first HTTP attempt.
- Preserve the altered request body and other changes across a 401 renewal
  retry without running the hooks again.
- Report the plugin that failed before any HTTP request is sent.
- Leave plugins without the hook and existing configurations unchanged.

## Non-goals

- Implement the GAIA tenant plugin.
- Add a response hook.
- Alter schema, renderer, or authentication provider APIs.
- Run hooks for dry-runs, which create no outgoing request.
- Apply request hooks to non-JSON:API schema or authentication traffic.

## Public plugin API

Add the following public types and optional method:

```ts
export type DropSHOperation =
  | "read"
  | "search"
  | "create"
  | "update"
  | "delete"
  | "upload";

export interface RequestContext extends PluginContext {
  operation: DropSHOperation;
  entityType?: string;
  bundle?: string;
}

export interface DropSHPlugin {
  readonly id: string;
  readonly requiredModules: string[];

  alterRequest?(
    req: HttpRequest,
    ctx: RequestContext,
  ): Promise<HttpRequest>;

  // Existing optional members remain unchanged.
}
```

`DropSHOperation` and `RequestContext` are exported from `src/plugin-api.ts`
alongside `DropSHPlugin`, `PluginContext`, and `HttpRequest`. A separate
transformer type is unnecessary because `alterRequest` follows the existing
method-based plugin API.

The method must return a complete `HttpRequest`. Returning `undefined` is a
runtime plugin error even for an untyped JavaScript plugin. The request body
keeps its current optional semantics: GET and DELETE normally have no body;
POST, PATCH, and upload receive their actual string or binary body.

## Request context

The JSON:API client assigns one semantic operation to every outgoing request:

| JSON:API client call | Operation |
| --- | --- |
| entity item GET | `read` |
| collection GET | `search` |
| POST | `create` |
| PATCH | `update` |
| DELETE | `delete` |
| binary upload POST | `upload` |

The client derives `entityType` and `bundle` centrally from the structured
JSON:API path. Plugins do not parse URLs. Root requests such as `me()` have no
entity target, so both values are `undefined`.

Higher-level client operations retain the operation of each actual request.
For example, `upsert()` produces a `search` followed by either `update` or
`create`.

## Composition and data flow

`defaultContext()` is the plugin composition point because it already owns the
configured plugin list and the stable `PluginContext` fields. It builds one
composed callback and passes it to `createJsonApiClient()` through an optional
`JsonApiOptions` member. The JSON:API client remains independent of
`DropSHPlugin`; it only invokes the callback with the request and operation
metadata.

For each request, the composed callback creates a `RequestContext` from the
stable plugin context plus `operation`, `entityType`, and `bundle`. It then
awaits each plugin's `alterRequest` in configured order, passing each returned
request to the next plugin.

The first-attempt flow is:

```text
build request
  -> apply authentication
  -> run alterRequest hooks once in plugin order
  -> send the returned request
```

This placement is intentional. `alterRequest` sees the complete authenticated
request and is the last extensibility callback before the first HTTP attempt.
It may alter any request field, including method, URL, headers,
`Authorization`, and body.

A no-op hook returns its input request. Its output at the `HttpClient` boundary
is byte-identical to the no-hook baseline.

## 401 renewal retry

The altered request becomes the retry base. On a 401 with a renewable auth
adapter, dropsh renews credentials and applies auth again to that already
altered request:

```text
altered request from attempt 1
  -> renew authentication
  -> apply renewed authentication
  -> send attempt 2
```

The alteration pipeline does not run again. The body and other alterations
therefore remain identical across attempts, while the auth adapter may replace
`Authorization` with renewed credentials on the retry.

This deliberately refines the ticket's initial auth-precedence proposal. On
the first attempt the plugin runs after auth and may change `Authorization`.
Only the 401 retry reapplies auth after the one-time alteration.

## Errors

Add a dedicated `PluginError` extending `CliError` with code `E_PLUGIN`. Its
message identifies the plugin and hook, and its details contain the plugin id,
hook name, and stringified cause. Export it through the existing public error
surface and give it a stable CLI exit-code mapping.

The composer wraps both a thrown/rejected hook error and an invalid
`undefined` result as `PluginError`. Composition finishes before the first
`HttpClient.send()` call, so no request is sent after a hook failure.

## Testing

Use a fake `HttpClient` to assert the exact request handed to `send()`.

Unit coverage must include:

1. `read`, `search`, `create`, `update`, `delete`, and `upload` context,
   including bodyless GET/DELETE and binary upload bodies;
2. JSON body alteration on create reaches the HTTP boundary;
3. two plugins run in configuration order and the second receives the first's
   result;
4. the first-attempt hook sees auth and may replace `Authorization`;
5. after a 401, the hook was called once, both attempts have the same altered
   body, and retry auth is renewed;
6. a no-op hook is byte-identical to the no-hook baseline;
7. a throwing or invalid hook produces `PluginError` naming the plugin and
   sends nothing;
8. plugins without `alterRequest` and configurations that name them are
   unchanged;
9. the public plugin entry point exports and type-checks `DropSHOperation`,
   `RequestContext`, and the updated `DropSHPlugin` interface.

The implementation gate is:

```bash
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run test:integration
```

The integration suite runs against a live DDEV instance and protects the
existing JSON:API, auth, and upload paths. Command results are recorded in the
coding handoff; the unit tests are the durable behavioral evidence.

## Acceptance criteria

1. A plugin declaring `alterRequest` receives each outgoing JSON:API request
   with its `HttpRequest` and a `RequestContext` containing the dropsh
   operation and available entity target.
2. GET and DELETE remain bodyless; POST, PATCH, and upload expose their string
   or binary body.
3. Multiple hooks run in configured plugin order, each receiving the previous
   hook's returned request.
4. The hook runs after auth and may alter every field, including
   `Authorization`, before the first HTTP attempt.
5. After a 401, renewal auth is applied to the already altered request without
   running hooks again; both attempts carry the same altered body.
6. Returning the input request produces a byte-identical request at the HTTP
   boundary.
7. A throwing, rejecting, or invalid hook produces a `PluginError` naming the
   plugin and sends nothing.
8. Plugins without `alterRequest` and all existing configurations remain
   unaffected.
9. The public `dropsh/plugin` entry point exports the new operation and context
   types.
10. Lint, type-check, unit, and selected integration checks pass.
