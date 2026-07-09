import { DrupalJsonApiParams } from "drupal-jsonapi-params";
import type { JsonApiClient } from "../core/jsonapi/client.js";
import { ValidationError } from "../errors.js";

export interface SearchArgs {
  entityType: string;
  bundle?: string;
  filters: string[];
  limit: number;
  include?: string[];
}

export interface SearchDeps {
  client: JsonApiClient;
  emit: (v: unknown) => void | Promise<void>;
}

export interface ParsedFilter {
  key: string;
  value: string;
  operator?: string;
}

export function parseFilterFlag(raw: string): ParsedFilter {
  const parts = raw.split(":");
  if (parts.length === 2) {
    const [key, value] = parts as [string, string];
    return { key, value };
  }
  if (parts.length >= 3) {
    const key = parts[0] as string;
    const operator = parts[1] as string;
    const value = parts.slice(2).join(":");
    return { key, operator, value };
  }
  throw new ValidationError(`--filter must be key:value or key:op:value, got "${raw}"`);
}

export async function runSearch(args: SearchArgs, deps: SearchDeps): Promise<void> {
  const params = new DrupalJsonApiParams();
  for (const raw of args.filters) {
    const f = parseFilterFlag(raw);
    if (f.operator) params.addFilter(f.key, f.value, f.operator);
    else params.addFilter(f.key, f.value);
  }
  params.addPageLimit(args.limit);
  if (args.include?.length) params.addInclude(args.include);
  const path = args.bundle ? `${args.entityType}/${args.bundle}` : args.entityType;
  const res = await deps.client.get(path, params);
  await deps.emit(res);
}
