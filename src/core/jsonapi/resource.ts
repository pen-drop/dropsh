/**
 * Ergonomic accessors over a raw JSON:API resource object.
 *
 * A {@link Resource} wraps the `data` member of a JSON:API document and exposes
 * typed helpers for attributes and relationships so callers stop digging through
 * nested `attributes`/`relationships` structures by hand.
 */

export interface JsonApiResourceIdentifier {
  id: string;
  type: string;
}

export interface JsonApiResourceObject {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<
    string,
    {
      data: JsonApiResourceIdentifier | JsonApiResourceIdentifier[] | null;
    }
  >;
}

export interface Resource {
  readonly id: string;
  readonly type: string;
  /** Read a single attribute, typed by the caller. Returns `undefined` if absent. */
  attr<T = unknown>(key: string): T | undefined;
  /** Related id for a to-one relationship, or `null` if missing/empty. */
  rel(key: string): string | null;
  /** Related ids for a to-many relationship. Returns `[]` if missing/empty. */
  rels(key: string): string[];
  /** The underlying raw JSON:API resource object. */
  readonly raw: JsonApiResourceObject;
}

export function toResource(obj: JsonApiResourceObject): Resource {
  return {
    id: obj.id,
    type: obj.type,
    raw: obj,
    attr<T = unknown>(key: string): T | undefined {
      return obj.attributes?.[key] as T | undefined;
    },
    rel(key: string): string | null {
      const data = obj.relationships?.[key]?.data;
      if (data === undefined || data === null) return null;
      if (Array.isArray(data)) return data[0]?.id ?? null;
      return data.id;
    },
    rels(key: string): string[] {
      const data = obj.relationships?.[key]?.data;
      if (data === undefined || data === null) return [];
      if (Array.isArray(data)) return data.map((d) => d.id);
      return [data.id];
    },
  };
}
