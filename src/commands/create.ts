import type { JsonApiClient } from "../core/jsonapi/client.js";

export interface CreateArgs {
  entityType: string;
  bundle: string;
  /**
   * The JSON:API document to send. Resolving it — from `--data` or from field
   * parameters — happens before this command runs, so nothing here knows or
   * cares which route produced it.
   */
  payload: unknown;
  dryRun?: boolean;
  noValidate?: boolean;
}
export interface CreateDeps {
  client: JsonApiClient;
  emit: (v: unknown) => void | Promise<void>;
  validate?: (payload: unknown, target: string) => void | Promise<void>;
}

export async function runCreate(args: CreateArgs, deps: CreateDeps): Promise<void> {
  const { payload } = args;
  const target = `${args.entityType}/${args.bundle}`;
  if (!args.noValidate && deps.validate) {
    await deps.validate(payload, target);
  }
  if (args.dryRun) {
    await deps.emit({ dry_run: true, method: "POST", path: target, payload });
    return;
  }
  const res = await deps.client.post(target, payload);
  await deps.emit(res);
}
