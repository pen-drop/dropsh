import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { JsonApiClient } from "../core/jsonapi/client.js";
import { ValidationError } from "../errors.js";

export interface UploadArgs {
  target: string;
  file: string;
  dryRun?: boolean;
}
export interface UploadDeps {
  client: JsonApiClient;
  emit: (v: unknown) => void;
}

const TARGET_RE = /^[a-z0-9_]+\/[a-z0-9_]+\/[a-f0-9-]{8,}\/[a-z0-9_]+$/;

export async function runUploadFile(args: UploadArgs, deps: UploadDeps): Promise<void> {
  if (!TARGET_RE.test(args.target)) {
    throw new ValidationError(
      `target must be <entity_type>/<bundle>/<uuid>/<field>, got "${args.target}"`,
    );
  }
  let fileSize = 0;
  try {
    fileSize = (await stat(args.file)).size;
  } catch {
    throw new ValidationError(`file does not exist: ${args.file}`);
  }
  const filename = path.basename(args.file);
  if (args.dryRun) {
    deps.emit({
      dry_run: true,
      method: "POST-upload",
      path: args.target,
      filename,
      bytes: fileSize,
    });
    return;
  }
  const data = await readFile(args.file);
  const res = await deps.client.upload(args.target, filename, data);
  deps.emit(res);
}
