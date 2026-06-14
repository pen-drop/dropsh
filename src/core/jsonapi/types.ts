/**
 * JSON:API resource type/path normalization.
 *
 * Drupal JSON:API addresses resources by a `entity/bundle` path (e.g.
 * `node/article`) but identifies them in document envelopes by a `entity--bundle`
 * type (e.g. `node--article`). This helper accepts either form plus a convenient
 * single-segment shorthand and produces both representations.
 */

export interface ResolvedType {
  /** URL path segment, e.g. `node/article`. */
  path: string;
  /** JSON:API resource type, e.g. `node--article`. */
  type: string;
}

/**
 * Resolve a loose type specifier into its `{ path, type }` pair.
 *
 * Accepted forms:
 * - `'gaia_run'`        -> `{ path: 'gaia_run/gaia_run', type: 'gaia_run--gaia_run' }`
 * - `'entity/bundle'`   -> `{ path: 'entity/bundle',     type: 'entity--bundle'      }`
 * - `'entity--bundle'`  -> `{ path: 'entity/bundle',     type: 'entity--bundle'      }`
 */
export function resolveType(spec: string): ResolvedType {
  if (spec.includes("--")) {
    return { type: spec, path: spec.replace(/--/g, "/") };
  }
  if (spec.includes("/")) {
    return { path: spec, type: spec.replace(/\//g, "--") };
  }
  return { path: `${spec}/${spec}`, type: `${spec}--${spec}` };
}
