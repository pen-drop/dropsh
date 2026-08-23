import { ValidationError } from "../../errors.js";
import type { RawParameter } from "../params/parse-args.js";
import {
  type FieldDescriptor,
  indexSchemaFields,
  propertiesOf,
  type SchemaFieldIndex,
} from "./schema-fields.js";

export interface BuildPayloadInput {
  /** The resolved operation schema, plugin extensions already applied. */
  schema: unknown;
  parameters: RawParameter[];
  operation: "create" | "update";
  /** Required for `update`: becomes `data.id`. */
  id?: string;
  /** Fallback resource type when the schema carries no `type` const/enum. */
  resourceType?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaTypeOf(node: unknown): string | undefined {
  if (!isRecord(node)) return undefined;
  const t = node.type;
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return t.find((x): x is string => typeof x === "string" && x !== "null");
  return undefined;
}

/**
 * Convert one command-line string into the value the leaf schema node asks for.
 * A non-convertible value is rejected here rather than left for Ajv, because
 * `--no-validate` must not turn a wrong type into a silently wrong payload.
 */
function coerce(node: unknown, param: RawParameter, label: string): unknown {
  const type = schemaTypeOf(node);
  if (!param.hasValue) {
    if (type === "boolean") return true;
    throw new ValidationError(
      `missing value for --${label}${type !== undefined ? ` (expected ${type})` : ""}`,
    );
  }
  if (type === "boolean") {
    if (param.value === "true") return true;
    if (param.value === "false") return false;
    throw new ValidationError(`--${label} expects true or false, got "${param.value}"`);
  }
  if (type === "integer" || type === "number") {
    const n = Number(param.value);
    if (param.value.trim() === "" || !Number.isFinite(n)) {
      throw new ValidationError(`--${label} expects ${type}, got "${param.value}"`);
    }
    if (type === "integer" && !Number.isInteger(n)) {
      throw new ValidationError(`--${label} expects integer, got "${param.value}"`);
    }
    return n;
  }
  return param.value;
}

function parseJsonValue(param: RawParameter): unknown {
  try {
    return JSON.parse(param.value) as unknown;
  } catch (err) {
    throw new ValidationError(`--json ${param.path} is not valid JSON: ${(err as Error).message}`);
  }
}

/**
 * Re-emit an object with its keys in the order its subschema declares them, so
 * the same fields always serialise to the same bytes.
 */
function ordered(node: unknown, value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = isRecord(node) ? node.items : undefined;
    return value.map((entry) => ordered(items, entry));
  }
  if (!isRecord(value)) return value;
  const props = propertiesOf(node);
  const keys = Object.keys(value);
  const declared = props ? Object.keys(props).filter((k) => keys.includes(k)) : [];
  const extra = keys.filter((k) => !declared.includes(k)).sort();
  const out: Record<string, unknown> = {};
  for (const key of [...declared, ...extra]) {
    out[key] = ordered(props?.[key], value[key]);
  }
  return out;
}

/**
 * Walk a dotted path into a field's subschema, rejecting a segment the schema
 * does not declare. Returns the leaf node the value must satisfy.
 */
function resolveLeaf(field: FieldDescriptor, segments: string[]): unknown {
  let node = field.node;
  for (const segment of segments) {
    const props = propertiesOf(node);
    const next = props?.[segment];
    if (next === undefined) {
      throw new ValidationError(
        `unknown sub-property '${segment}' of '${field.name}'${
          props ? `; known: ${Object.keys(props).join(", ")}` : ""
        }`,
      );
    }
    node = next;
  }
  return node;
}

function assign(
  target: Record<string, unknown>,
  segments: string[],
  value: unknown,
  label: string,
): void {
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (existing === undefined) {
      const created: Record<string, unknown> = {};
      cursor[segment] = created;
      cursor = created;
    } else if (isRecord(existing)) {
      cursor = existing;
    } else {
      throw new ValidationError(`parameter '${label}' conflicts with an earlier value`);
    }
  }
  const leaf = segments[segments.length - 1] as string;
  if (leaf in cursor) {
    throw new ValidationError(`parameter '${label}' was given more than once`);
  }
  cursor[leaf] = value;
}

function unknownParameter(name: string, index: SchemaFieldIndex): never {
  const attributes: string[] = [];
  const relationships: string[] = [];
  for (const field of index.fields.values()) {
    (field.kind === "attribute" ? attributes : relationships).push(field.name);
  }
  throw new ValidationError(
    `unknown parameter '${name}'. Known attributes: ${attributes.join(", ") || "(none)"}. ` +
      `Known relationships: ${relationships.join(", ") || "(none)"}. ` +
      "A field whose name is a reserved option is reachable as --set <field>=<value>.",
  );
}

interface ResourceIdentifier {
  type: string;
  id: string;
}

/**
 * A relationship parameter is a bare UUID whenever the schema allows exactly one
 * target type, and `<type>:<uuid>` when it allows several. The UUID itself never
 * contains a colon, so the split is unambiguous.
 */
function resourceIdentifier(field: FieldDescriptor, param: RawParameter): ResourceIdentifier {
  if (!param.hasValue) {
    throw new ValidationError(`missing value for --${field.name} (expected a UUID)`);
  }
  const allowed = field.targetTypes ?? [];
  const colon = param.value.lastIndexOf(":");
  if (colon > 0) {
    const type = param.value.slice(0, colon);
    const id = param.value.slice(colon + 1);
    if (allowed.length > 0 && !allowed.includes(type)) {
      throw new ValidationError(
        `'${type}' is not an allowed target type for '${field.name}'; allowed: ${allowed.join(", ")}`,
      );
    }
    return { type, id };
  }
  if (allowed.length === 0) {
    throw new ValidationError(
      `relationship '${field.name}' declares no target type in the schema; pass <type>:<uuid>`,
    );
  }
  if (allowed.length > 1) {
    throw new ValidationError(
      `relationship '${field.name}' allows several target types (${allowed.join(", ")}); ` +
        "pass <type>:<uuid>",
    );
  }
  return { type: allowed[0] as string, id: param.value };
}

export function buildPayloadFromParameters(input: BuildPayloadInput): unknown {
  const index = indexSchemaFields(input.schema);
  const attributes: Record<string, unknown> = {};
  const relationships = new Map<string, ResourceIdentifier[]>();

  for (const param of input.parameters) {
    const segments = param.path.split(".");
    const name = segments[0] as string;
    const field = index.fields.get(name);
    if (!field) unknownParameter(name, index);

    if (field.kind === "relationship") {
      if (segments.length > 1) {
        throw new ValidationError(
          `relationship '${name}' takes a UUID, not a sub-path ('${param.path}')`,
        );
      }
      const collected = relationships.get(name) ?? [];
      if (collected.length > 0 && field.multiple !== true) {
        throw new ValidationError(
          `relationship '${name}' accepts a single value; it was given more than once`,
        );
      }
      collected.push(resourceIdentifier(field, param));
      relationships.set(name, collected);
      continue;
    }

    const tail = segments.slice(1);
    const leaf = resolveLeaf(field, tail);
    const value =
      param.form === "json"
        ? ordered(leaf, parseJsonValue(param))
        : coerce(leaf, param, param.path);
    assign(attributes, segments, value, param.path);
  }

  const resourceType = index.resourceType ?? input.resourceType;
  if (resourceType === undefined) {
    throw new ValidationError(
      "cannot determine the JSON:API resource type: the schema declares no type and no fallback was given",
    );
  }

  const data: Record<string, unknown> = { type: resourceType };
  if (input.operation === "update") {
    if (input.id === undefined || input.id === "") {
      throw new ValidationError("update requires the entity id for data.id");
    }
    data.id = input.id;
  }
  const attributeNode = propertiesOf(propertiesOf(input.schema)?.data)?.attributes;
  if (Object.keys(attributes).length > 0) {
    data.attributes = ordered(attributeNode, attributes);
  }
  if (relationships.size > 0) {
    const out: Record<string, unknown> = {};
    for (const name of index.order) {
      const collected = relationships.get(name);
      if (!collected) continue;
      const field = index.fields.get(name) as FieldDescriptor;
      out[name] = {
        data: field.multiple === true ? collected : (collected[0] as ResourceIdentifier),
      };
    }
    data.relationships = out;
  }
  return { data };
}
