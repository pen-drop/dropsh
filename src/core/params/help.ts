import { type FieldDescriptor, indexSchemaFields, propertiesOf } from "./schema-fields.js";

/**
 * The `--help` block for the write commands. It documents the *forms* only and
 * points at `--fields` for the bundle's actual field names: Commander renders
 * help synchronously, so it cannot resolve a schema, while `--fields` runs in
 * the action and goes through the normal fetch-and-cache pipeline.
 */
export const FIELD_PARAMETER_HELP = `
Field parameters (instead of --data):
  --<field> <value>          set a field, e.g. --title "Hello"
  --<field>=<value>          same; also the form for many fields in one call
  --<field>.<sub> <value>    set a sub-property, e.g. --body.value "Text"
  --<relationship> <uuid>    reference by UUID; repeat for a multi-valued field
  --json <field>=<json>      raw JSON value, for arrays of objects

Add --fields to list this bundle's actual field parameters and exit without
sending anything. An unknown field name is rejected, never ignored.

A value starting with -- needs the --<field>=<value> form. A field whose name
collides with a reserved option (--bundle, --data, --dry-run, --no-validate,
--fields, --format, --auth-profile, --config, --view-mode, --json) can only be
set through --data.

Example:
  dropsh create node --bundle article --fields
  dropsh create node --bundle article --title "Hello" --body.value "Text" --dry-run`;

export interface AttributeDescription {
  /** How to pass it on the command line. */
  parameter: string;
  /** Dotted path into `data.attributes`. */
  path: string;
  type?: string;
  /** Present only when the field can be given as a bare `--flag`. */
  bare_flag?: true;
}

export interface RelationshipDescription {
  parameter: string;
  path: string;
  targets: string[];
  multiple: boolean;
  /** Present only when several target types make `<type>:<uuid>` mandatory. */
  requires_type_prefix?: true;
}

export interface FieldsDescription {
  type?: string;
  attributes: AttributeDescription[];
  relationships: RelationshipDescription[];
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

function describeAttribute(path: string, node: unknown): AttributeDescription {
  const type = schemaTypeOf(node);
  // An array is unreachable through a scalar flag; --json is the only way in.
  const parameter = type === "array" ? `--json ${path}=<json>` : `--${path}`;
  return {
    parameter,
    path,
    ...(type !== undefined ? { type } : {}),
    ...(type === "boolean" ? { bare_flag: true as const } : {}),
  };
}

/** An object attribute is settable only through its leaves, so recurse into them. */
function describeAttributeTree(path: string, node: unknown): AttributeDescription[] {
  const props = schemaTypeOf(node) === "array" ? undefined : propertiesOf(node);
  if (!props || Object.keys(props).length === 0) return [describeAttribute(path, node)];
  return Object.entries(props).flatMap(([sub, subNode]) =>
    describeAttributeTree(`${path}.${sub}`, subNode),
  );
}

function describeRelationship(field: FieldDescriptor): RelationshipDescription {
  const targets = field.targetTypes ?? [];
  const ambiguous = targets.length !== 1;
  return {
    parameter: `--${field.name} ${ambiguous ? "<type>:<uuid>" : "<uuid>"}`,
    path: field.name,
    targets,
    multiple: field.multiple === true,
    ...(ambiguous ? { requires_type_prefix: true as const } : {}),
  };
}

/**
 * Turn a resolved operation schema into the machine-readable field listing that
 * `--fields` prints: every settable parameter, in schema declaration order.
 */
export function describeFields(schema: unknown): FieldsDescription {
  const index = indexSchemaFields(schema);
  const attributes: AttributeDescription[] = [];
  const relationships: RelationshipDescription[] = [];
  for (const name of index.order) {
    const field = index.fields.get(name);
    if (!field) continue;
    if (field.kind === "attribute") attributes.push(...describeAttributeTree(name, field.node));
    else relationships.push(describeRelationship(field));
  }
  return {
    ...(index.resourceType !== undefined ? { type: index.resourceType } : {}),
    attributes,
    relationships,
  };
}
