import { DrupalJsonApiParams } from "drupal-jsonapi-params";
import type { JsonApiClient } from "../core/jsonapi/client.js";
import { ValidationError } from "../errors.js";

export interface ReadArgs {
  target: string;
  include?: string[];
}
export interface ReadDeps {
  client: JsonApiClient;
  emit: (v: unknown) => void | Promise<void>;
}

// Allow short test UUIDs (e.g. "u1") and full Drupal UUIDs (36 chars)
const TARGET_RE = /^[a-z0-9_]+\/[a-z0-9_]+\/[a-z0-9_-]+$/;

export async function runRead(args: ReadArgs, deps: ReadDeps): Promise<void> {
  if (!TARGET_RE.test(args.target)) {
    throw new ValidationError(`target must be <entity_type>/<bundle>/<uuid>, got "${args.target}"`);
  }
  let res: unknown;
  if (args.include?.length) {
    const params = new DrupalJsonApiParams();
    params.addInclude(args.include);
    res = await deps.client.get(args.target, params);
  } else {
    res = await deps.client.get(args.target);
  }
  await deps.emit(res);
}
