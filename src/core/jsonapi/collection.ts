import { DrupalJsonApiParams } from "drupal-jsonapi-params";
import { type JsonApiResourceObject, type Resource, toResource } from "./resource.js";
import { type ResolvedType, resolveType } from "./types.js";

export type FilterOp = "=" | "<>" | ">" | ">=" | "<" | "<=" | "STARTS_WITH" | "CONTAINS";

export interface Collection {
  where(path: string, op: FilterOp, value: string | number): Collection;
  /** Match any of the given values (JSON:API `IN` operator). */
  whereIn(path: string, values: Array<string | number>): Collection;
  /** Require the field to be empty (JSON:API `IS NULL` operator). */
  notExists(path: string): Collection;
  /** Restrict the sparse fieldset for this collection's resource type. */
  fields(names: string[]): Collection;
  sort(path: string, dir?: "ASC" | "DESC"): Collection;
  page(limit: number): Collection;
  list(): Promise<Resource[]>;
  /** First match, or `null`. Applies `page(1)` to keep the request minimal. */
  first(): Promise<Resource | null>;
  /**
   * Number of matching resources.
   *
   * CAVEAT: this counts the rows returned by a single `list()` request and is
   * therefore bounded by the active page limit (default JSON:API page size is
   * 50). It does not read JSON:API `meta.count` and will under-report when the
   * result set exceeds the page limit. Use it only for small/known-bounded sets.
   */
  count(): Promise<number>;
}

/** Minimal client surface a {@link Collection} needs — keeps it decoupled. */
export interface CollectionClient {
  get(path: string, params?: DrupalJsonApiParams): Promise<unknown>;
}

interface JsonApiListDocument {
  data?: JsonApiResourceObject[];
}

export function createCollection(
  client: CollectionClient,
  spec: string,
  params: DrupalJsonApiParams = new DrupalJsonApiParams(),
): Collection {
  const resolved: ResolvedType = resolveType(spec);

  const collection: Collection = {
    where(path, op, value) {
      if (op === "=") params.addFilter(path, String(value));
      else params.addFilter(path, String(value), op);
      return collection;
    },
    whereIn(path, values) {
      params.addFilter(path, values.map(String), "IN");
      return collection;
    },
    notExists(path) {
      params.addFilter(path, null, "IS NULL");
      return collection;
    },
    fields(names) {
      params.addFields(resolved.type, names);
      return collection;
    },
    sort(path, dir) {
      params.addSort(path, dir);
      return collection;
    },
    page(limit) {
      params.addPageLimit(limit);
      return collection;
    },
    async list() {
      const doc = (await client.get(resolved.path, params)) as JsonApiListDocument;
      const data = doc?.data ?? [];
      return data.map(toResource);
    },
    async first() {
      const results = await collection.page(1).list();
      return results[0] ?? null;
    },
    async count() {
      const results = await collection.fields([]).list();
      return results.length;
    },
  };

  return collection;
}
