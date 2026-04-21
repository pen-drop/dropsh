import type { JsonApiClient } from "../core/jsonapi/client.js";
import { readDataArg } from "./_data.js";

export interface CreateArgs {
  entityType: string;
  bundle: string;
  dataArg: string;
  dryRun?: boolean;
}
export interface CreateDeps {
  client: JsonApiClient;
  emit: (v: unknown) => void;
}

export async function runCreate(args: CreateArgs, deps: CreateDeps): Promise<void> {
  const payload = await readDataArg(args.dataArg);
  const path = `${args.entityType}/${args.bundle}`;
  if (args.dryRun) {
    deps.emit({ dry_run: true, method: "POST", path, payload });
    return;
  }
  const res = await deps.client.post(path, payload);
  deps.emit(res);
}
