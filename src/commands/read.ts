import type { JsonApiClient } from "../core/jsonapi/client.js";
import { ValidationError } from "../errors.js";

export interface ReadArgs { target: string; }
export interface ReadDeps { client: JsonApiClient; emit: (v: unknown) => void; }

// Allow short test UUIDs (e.g. "u1") and full Drupal UUIDs (36 chars)
const TARGET_RE = /^[a-z0-9_]+\/[a-z0-9_]+\/[a-z0-9_-]+$/;

export async function runRead(args: ReadArgs, deps: ReadDeps): Promise<void> {
  if (!TARGET_RE.test(args.target)) {
    throw new ValidationError(`target must be <entity_type>/<bundle>/<uuid>, got "${args.target}"`);
  }
  const res = await deps.client.get(args.target);
  deps.emit(res);
}
