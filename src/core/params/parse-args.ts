import { ValidationError } from "../../errors.js";

export interface RawParameter {
  /** Dotted path into the payload, e.g. "title" or "body.value". */
  path: string;
  value: string;
  /** Which surface syntax produced it; "json" means `value` is raw JSON. */
  form: "flag" | "json";
  /**
   * False for a bare `--field` with no following value. Whether that is legal
   * depends on the field's schema type, so the decision belongs to the builder.
   */
  hasValue: boolean;
}

/**
 * `--json` is the one collector: it takes `<field>=<json>` pairs rather than a
 * value of its own, because a raw JSON value cannot be coerced from the leaf
 * schema type. The collector name is matched before any other handling, so the
 * pair's left-hand side is an arbitrary field path — including one that collides
 * with a reserved option, or `json` itself. That makes `--json <field>=<json>` a
 * second route to such a field besides `--data`; only the bare `--<field>` form
 * is out of reach.
 */
const COLLECTORS = new Set(["json"]);

function splitPair(pair: string, collector: string): { path: string; value: string } {
  const eq = pair.indexOf("=");
  if (eq <= 0) {
    throw new ValidationError(`--${collector} expects <field>=<value> pairs, got "${pair}"`);
  }
  return { path: pair.slice(0, eq), value: pair.slice(eq + 1) };
}

/**
 * Parse the token stream Commander passes through for unknown options into an
 * ordered parameter list. Purely syntactic: no schema is consulted, so an
 * unknown field name is not an error here.
 */
export function parseFieldArgs(tokens: string[]): RawParameter[] {
  const out: RawParameter[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i] as string;
    if (!token.startsWith("--")) {
      throw new ValidationError(
        `unexpected argument "${token}"; field parameters are long options (--<field> <value>)`,
      );
    }
    const body = token.slice(2);
    if (body.length === 0) {
      throw new ValidationError('"--" is not a field parameter');
    }
    const eq = body.indexOf("=");
    const name = eq === -1 ? body : body.slice(0, eq);

    if (COLLECTORS.has(name)) {
      const pairs: string[] = [];
      if (eq !== -1) {
        pairs.push(body.slice(eq + 1));
        i += 1;
      } else {
        i += 1;
        while (i < tokens.length && !(tokens[i] as string).startsWith("--")) {
          pairs.push(tokens[i] as string);
          i += 1;
        }
      }
      if (pairs.length === 0) {
        throw new ValidationError(`--${name} expects at least one <field>=<value> pair`);
      }
      for (const pair of pairs) {
        const { path, value } = splitPair(pair, name);
        out.push({ path, value, form: "json", hasValue: true });
      }
      continue;
    }

    if (eq !== -1) {
      out.push({ path: name, value: body.slice(eq + 1), form: "flag", hasValue: true });
      i += 1;
      continue;
    }
    const next = tokens[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out.push({ path: name, value: next, form: "flag", hasValue: true });
      i += 2;
      continue;
    }
    out.push({ path: name, value: "", form: "flag", hasValue: false });
    i += 1;
  }
  return out;
}
