import { ValidationError } from "dropsh/plugin";

function coerce(type: unknown, key: string, value: string): unknown {
  if (type === "integer" || type === "number") {
    const n = Number(value);
    // Keep the string when it is not a number so schema validation names the error.
    return value.trim() === "" || Number.isNaN(n) ? value : n;
  }
  if (type === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }
  if (type === "object" || type === "array") {
    try {
      return JSON.parse(value);
    } catch (err) {
      throw new ValidationError(`--param ${key} is not valid JSON: ${(err as Error).message}`);
    }
  }
  return value;
}

/** Arguments from `--data` (a JSON object) overridden by `--param k=v` pairs, coerced by the input schema. */
export function buildArguments(
  schema: Record<string, unknown>,
  data: unknown,
  params: string[],
): Record<string, unknown> {
  if (data !== undefined && (typeof data !== "object" || data === null || Array.isArray(data))) {
    throw new ValidationError("--data must be a JSON object");
  }
  const args: Record<string, unknown> = { ...(data as Record<string, unknown> | undefined) };
  const properties = (schema.properties ?? {}) as Record<string, { type?: unknown }>;
  for (const param of params) {
    const eq = param.indexOf("=");
    if (eq < 1) throw new ValidationError(`--param '${param}' must be key=value`);
    const key = param.slice(0, eq);
    args[key] = coerce(properties[key]?.type, key, param.slice(eq + 1));
  }
  return args;
}
