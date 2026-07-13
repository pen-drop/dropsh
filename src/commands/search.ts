import { DrupalJsonApiParams } from "drupal-jsonapi-params";
import type { JsonApiClient } from "../core/jsonapi/client.js";
import { ValidationError } from "../errors.js";

export interface SearchArgs {
  entityType: string;
  bundle?: string;
  filters: string[];
  limit: number;
  offset?: number;
  /** JSON:API sort field; a leading `-` requests descending order. */
  sort?: string;
  include?: string[];
}

export interface SearchDeps {
  client: JsonApiClient;
  emit: (v: unknown) => void | Promise<void>;
}

export interface ParsedFilter {
  key: string;
  /** Filter value, or `null` for value-less operators (IS NULL / IS NOT NULL). */
  value: string | null;
  operator?: string;
}

/**
 * JSON:API filter operators recognised in the `key:op:value` form. Only when
 * segment 2 of a `--filter` matches one of these is it treated as an operator;
 * otherwise the remainder is kept verbatim as the value (so a value containing
 * a colon — e.g. a URL — parses as key:value, not key:op:value).
 *
 * `!=` is accepted as an alias of `<>`; it is normalised to `<>` before the
 * request is built (Drupal's allowed-operators list has `<>`, not `!=`).
 */
const KNOWN_OPERATORS = new Set([
  "=",
  "<>",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "CONTAINS",
  "STARTS_WITH",
  "ENDS_WITH",
  "IN",
  "NOT IN",
  "BETWEEN",
  "NOT BETWEEN",
  "IS NULL",
  "IS NOT NULL",
]);

/** Operators that take no value; expressed as `key:IS NULL` / `key:IS NOT NULL`. */
const VALUELESS_OPERATORS = new Set(["IS NULL", "IS NOT NULL"]);

/**
 * Operators whose value is a list; the `--filter` value is split on commas into
 * an array (e.g. `key:IN:a,b,c`). Drupal rejects a scalar for these.
 */
const MULTI_VALUE_OPERATORS = new Set(["IN", "NOT IN", "BETWEEN", "NOT BETWEEN"]);

export function parseFilterFlag(raw: string): ParsedFilter {
  const parts = raw.split(":");
  if (parts.length < 2) {
    throw new ValidationError(`--filter must be key:value or key:op:value, got "${raw}"`);
  }
  const key = parts[0] as string;
  const rest = parts.slice(1).join(":");
  // key:IS NULL / key:IS NOT NULL — value-less operator.
  if (VALUELESS_OPERATORS.has(rest)) {
    return { key, operator: rest, value: null };
  }
  // key:op:value — only when segment 2 is a known operator.
  if (parts.length >= 3 && KNOWN_OPERATORS.has(parts[1] as string)) {
    return { key, operator: parts[1] as string, value: parts.slice(2).join(":") };
  }
  // key:value — value kept verbatim (may contain colons, e.g. a URL).
  return { key, value: rest };
}

export async function runSearch(args: SearchArgs, deps: SearchDeps): Promise<void> {
  const params = new DrupalJsonApiParams();
  for (const raw of args.filters) {
    const f = parseFilterFlag(raw);
    if (f.operator === undefined) {
      params.addFilter(f.key, f.value);
      continue;
    }
    // `!=` is an alias of `<>`; Drupal's allowed operators do not include `!=`.
    const operator = f.operator === "!=" ? "<>" : f.operator;
    // List operators (IN/NOT IN/BETWEEN/NOT BETWEEN) take an array value.
    const value =
      f.value !== null && MULTI_VALUE_OPERATORS.has(operator) ? f.value.split(",") : f.value;
    params.addFilter(f.key, value, operator);
  }
  params.addPageLimit(args.limit);
  if (args.offset !== undefined) {
    if (!Number.isInteger(args.offset) || args.offset < 0) {
      throw new ValidationError(`--offset must be a non-negative integer, got "${args.offset}"`);
    }
    params.addPageOffset(args.offset);
  }
  if (args.sort) {
    const descending = args.sort.startsWith("-");
    const field = descending ? args.sort.slice(1) : args.sort;
    if (field === "") {
      throw new ValidationError(`--sort requires a field name, got "${args.sort}"`);
    }
    params.addSort(field, descending ? "DESC" : "ASC");
  }
  if (args.include?.length) params.addInclude(args.include);
  const path = args.bundle ? `${args.entityType}/${args.bundle}` : args.entityType;
  const res = await deps.client.get(path, params);
  await deps.emit(res);
}
