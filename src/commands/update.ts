import type { JsonApiClient } from "../core/jsonapi/client.js";
import { ValidationError } from "../errors.js";
import { readDataArg } from "./_data.js";

export interface UpdateArgs {
  target: string;
  dataArg: string;
  dryRun?: boolean;
}
export interface UpdateDeps {
  client: JsonApiClient;
  emit: (v: unknown) => void;
}

const TARGET_RE = /^[a-z0-9_]+\/[a-z0-9_]+\/[a-z0-9-]+$/;

export async function runUpdate(args: UpdateArgs, deps: UpdateDeps): Promise<void> {
  if (!TARGET_RE.test(args.target)) {
    throw new ValidationError(`target must be <entity_type>/<bundle>/<uuid>, got "${args.target}"`);
  }
  const payload = await readDataArg(args.dataArg);
  if (args.dryRun) {
    deps.emit({ dry_run: true, method: "PATCH", path: args.target, payload });
    return;
  }
  const res = await deps.client.patch(args.target, payload);
  deps.emit(res);
}
