import type { JsonApiClient } from "../core/jsonapi/client.js";
import { ValidationError } from "../errors.js";

export interface DeleteArgs { target: string; dryRun?: boolean; }
export interface DeleteDeps { client: JsonApiClient; emit: (v: unknown) => void; }

const TARGET_RE = /^[a-z0-9_]+\/[a-z0-9_]+\/[a-f0-9-]{8,}$/;

export async function runDelete(args: DeleteArgs, deps: DeleteDeps): Promise<void> {
  if (!TARGET_RE.test(args.target)) {
    throw new ValidationError(`target must be <entity_type>/<bundle>/<uuid>, got "${args.target}"`);
  }
  if (args.dryRun) {
    deps.emit({ dry_run: true, method: "DELETE", path: args.target });
    return;
  }
  const res = await deps.client.delete(args.target);
  deps.emit(res);
}
