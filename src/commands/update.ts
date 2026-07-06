import type { JsonApiClient } from "../core/jsonapi/client.js";
import { ValidationError } from "../errors.js";
import { readDataArg } from "./_data.js";

export interface UpdateArgs {
  target: string;
  dataArg: string;
  dryRun?: boolean;
  noValidate?: boolean;
}
export interface UpdateDeps {
  client: JsonApiClient;
  emit: (v: unknown) => void | Promise<void>;
  validate?: (payload: unknown, target: string) => void | Promise<void>;
}

const TARGET_RE = /^[a-z0-9_]+\/[a-z0-9_]+\/[a-f0-9-]{8,}$/;

export async function runUpdate(args: UpdateArgs, deps: UpdateDeps): Promise<void> {
  if (!TARGET_RE.test(args.target)) {
    throw new ValidationError(`target must be <entity_type>/<bundle>/<uuid>, got "${args.target}"`);
  }
  const payload = await readDataArg(args.dataArg);
  const [entity, bundle] = args.target.split("/", 3) as [string, string, string];
  const schemaTarget = `${entity}/${bundle}`;
  if (!args.noValidate && deps.validate) {
    await deps.validate(payload, schemaTarget);
  }
  if (args.dryRun) {
    await deps.emit({ dry_run: true, method: "PATCH", path: args.target, payload });
    return;
  }
  const res = await deps.client.patch(args.target, payload);
  await deps.emit(res);
}
