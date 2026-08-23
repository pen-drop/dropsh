import type { JsonApiClient } from "../core/jsonapi/client.js";
import { ValidationError } from "../errors.js";
import { readDataArg } from "./_data.js";

export interface CreateArgs {
  entityType: string;
  bundle: string;
  /** Raw `--data` argument (inline JSON or @path). Absent in parameter mode. */
  dataArg?: string;
  /** Document already built from field parameters. Absent in `--data` mode. */
  payload?: unknown;
  dryRun?: boolean;
  noValidate?: boolean;
}
export interface CreateDeps {
  client: JsonApiClient;
  emit: (v: unknown) => void | Promise<void>;
  validate?: (payload: unknown, target: string) => void | Promise<void>;
}

export async function runCreate(args: CreateArgs, deps: CreateDeps): Promise<void> {
  if (args.payload === undefined && args.dataArg === undefined) {
    throw new ValidationError("provide either --data or field parameters (--<field> <value>)");
  }
  const payload =
    args.payload !== undefined ? args.payload : await readDataArg(args.dataArg as string);
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
