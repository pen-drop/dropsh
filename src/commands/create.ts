import type { JsonApiClient } from "../core/jsonapi/client.js";
import { readDataArg } from "./_data.js";

export interface CreateArgs {
  entityType: string;
  bundle: string;
  dataArg: string;
  dryRun?: boolean;
  noValidate?: boolean;
}
export interface CreateDeps {
  client: JsonApiClient;
  emit: (v: unknown) => void;
  validate?: (payload: unknown, target: string) => void | Promise<void>;
}

export async function runCreate(args: CreateArgs, deps: CreateDeps): Promise<void> {
  const payload = await readDataArg(args.dataArg);
  const target = `${args.entityType}/${args.bundle}`;
  if (!args.noValidate && deps.validate) {
    await deps.validate(payload, target);
  }
  if (args.dryRun) {
    deps.emit({ dry_run: true, method: "POST", path: target, payload });
    return;
  }
  const res = await deps.client.post(target, payload);
  deps.emit(res);
}
