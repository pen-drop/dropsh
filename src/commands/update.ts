import type { JsonApiClient } from "../core/jsonapi/client.js";
import { ValidationError } from "../errors.js";

export interface UpdateArgs {
  target: string;
  /**
   * The JSON:API document to send. Resolving it — from `--data` or from field
   * parameters — happens before this command runs, so nothing here knows or
   * cares which route produced it.
   */
  payload: unknown;
  dryRun?: boolean;
  noValidate?: boolean;
}
export interface UpdateDeps {
  client: JsonApiClient;
  emit: (v: unknown) => void | Promise<void>;
  validate?: (payload: unknown, target: string) => void | Promise<void>;
}

const TARGET_RE = /^[a-z0-9_]+\/[a-z0-9_]+\/[a-f0-9-]{8,}$/;

/**
 * Reject a malformed target. Exported so the CLI can run this guard *before* it
 * builds a payload from field parameters: without it, a bad target would surface
 * as the builder's "update requires the entity id" instead of this clearer
 * message.
 */
export function assertUpdateTarget(target: string): void {
  if (!TARGET_RE.test(target)) {
    throw new ValidationError(`target must be <entity_type>/<bundle>/<uuid>, got "${target}"`);
  }
}

export async function runUpdate(args: UpdateArgs, deps: UpdateDeps): Promise<void> {
  assertUpdateTarget(args.target);
  const { payload } = args;
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
