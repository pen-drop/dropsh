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
  /** The complete command-line spelling, value placeholder included. */
  parameter: string;
  /** Dotted path into `data.attributes`. */
  path: string;
  type?: string;
  /** The field's human label, from the schema's `title`. */
  label?: string;
  /** Present only when the schema requires the field. */
  required?: true;
  /** Present only when the field can be given as a bare `--flag`. */
  bare_flag?: true;
}

export interface RelationshipDescription {
  parameter: string;
  path: string;
  targets: string[];
  multiple: boolean;
  /** The relationship's human label, from the schema's `title`. */
  label?: string;
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

function labelOf(node: unknown): string | undefined {
  if (!isRecord(node)) return undefined;
  return typeof node.title === "string" ? node.title : undefined;
}

/** The command-line spelling, including how the value is written. */
function spell(path: string, type: string | undefined): string {
  if (type === "array") return `--json ${path}=<json>`;
  if (type === "boolean") return `--${path} [true|false]`;
  return `--${path} <value>`;
}

function describeAttribute(path: string, node: unknown, required: boolean): AttributeDescription {
  const type = schemaTypeOf(node);
  const label = labelOf(node);
  return {
    parameter: spell(path, type),
    path,
    ...(type !== undefined ? { type } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(required ? { required: true as const } : {}),
    ...(type === "boolean" ? { bare_flag: true as const } : {}),
  };
}

/** An object attribute is settable only through its leaves, so recurse into them. */
function describeAttributeTree(
  path: string,
  node: unknown,
  required: boolean,
): AttributeDescription[] {
  const props = schemaTypeOf(node) === "array" ? undefined : propertiesOf(node);
  if (!props || Object.keys(props).length === 0) {
    return [describeAttribute(path, node, required)];
  }
  const req = isRecord(node) && Array.isArray(node.required) ? node.required : [];
  return Object.entries(props).flatMap(([sub, subNode]) =>
    describeAttributeTree(`${path}.${sub}`, subNode, required && req.includes(sub)),
  );
}

function describeRelationship(field: FieldDescriptor): RelationshipDescription {
  const targets = field.targetTypes ?? [];
  const ambiguous = targets.length !== 1;
  const label = labelOf(field.node);
  return {
    parameter: `--${field.name} ${ambiguous ? "<type>:<uuid>" : "<uuid>"}`,
    path: field.name,
    targets,
    multiple: field.multiple === true,
    ...(label !== undefined ? { label } : {}),
    ...(ambiguous ? { requires_type_prefix: true as const } : {}),
  };
}

/**
 * Turn a resolved operation schema into the machine-readable field listing that
 * `--fields` prints: every settable parameter, in schema declaration order.
 */
export function describeFields(schema: unknown): FieldsDescription {
  const index = indexSchemaFields(schema);
  const attributeNode = propertiesOf(propertiesOf(schema)?.data)?.attributes;
  const requiredNames =
    isRecord(attributeNode) && Array.isArray(attributeNode.required) ? attributeNode.required : [];
  const attributes: AttributeDescription[] = [];
  const relationships: RelationshipDescription[] = [];
  for (const name of index.order) {
    const field = index.fields.get(name);
    if (!field) continue;
    if (field.kind === "attribute") {
      attributes.push(...describeAttributeTree(name, field.node, requiredNames.includes(name)));
    } else relationships.push(describeRelationship(field));
  }
  return {
    ...(index.resourceType !== undefined ? { type: index.resourceType } : {}),
    attributes,
    relationships,
  };
}

/**
 * Render the field listing as an aligned, human-readable table — what `--fields`
 * prints by default. `--format json` yields `describeFields` verbatim instead,
 * for a caller that wants to consume it.
 */
export function renderFieldsTable(described: FieldsDescription): string {
  const { attributes, relationships } = described;
  const head = `${described.type ?? "this bundle"} — field parameters`;
  if (attributes.length === 0 && relationships.length === 0) {
    return `${head}\n\nThe schema declares no field parameters for this bundle.`;
  }

  const rows: Array<[string, string]> = [];
  for (const a of attributes) {
    const notes = [a.type ?? "", a.required ? "required" : "", a.label ?? ""].filter(
      (n) => n !== "",
    );
    rows.push([a.parameter, notes.join("  ")]);
  }
  const attributeRows = rows.length;
  for (const r of relationships) {
    const notes = [
      r.targets.join(" | ") || "(no target type declared)",
      r.multiple ? "repeatable" : "",
      r.label ?? "",
    ].filter((n) => n !== "");
    rows.push([r.parameter, notes.join("  ")]);
  }

  const width = Math.max(...rows.map(([p]) => p.length)) + 2;
  const line = ([p, notes]: [string, string]) =>
    notes === "" ? `  ${p}` : `  ${p.padEnd(width)}${notes}`;

  const out = [head];
  if (attributeRows > 0) {
    out.push("", "Attributes:", ...rows.slice(0, attributeRows).map(line));
  }
  if (relationships.length > 0) {
    out.push("", "Relationships (take a UUID):", ...rows.slice(attributeRows).map(line));
  }
  return out.join("\n");
}
