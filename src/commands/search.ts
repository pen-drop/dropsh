import type { JsonApiClient } from "../core/jsonapi/client.js";
import type { FilterSpec } from "../core/jsonapi/query.js";
import { ValidationError } from "../errors.js";

export interface SearchArgs {
  entityType: string;
  bundle?: string;
  filters: string[];
  limit: number;
}

export interface SearchDeps {
  client: JsonApiClient;
  emit: (v: unknown) => void;
}

export function parseFilterFlag(raw: string): FilterSpec {
  const parts = raw.split(":");
  if (parts.length === 2) {
    const [key, value] = parts;
    return { key: key!, value: value! };
  }
  if (parts.length >= 3) {
    const key = parts[0]!;
    const operator = parts[1]!;
    const value = parts.slice(2).join(":");
    return { key, operator, value };
  }
  throw new ValidationError(`--filter must be key:value or key:op:value, got "${raw}"`);
}

export async function runSearch(args: SearchArgs, deps: SearchDeps): Promise<void> {
  const filters = args.filters.map(parseFilterFlag);
  const path = args.bundle ? `${args.entityType}/${args.bundle}` : args.entityType;
  const res = await deps.client.get(path, { filter: filters, page: { limit: args.limit } });
  deps.emit(res);
}
