import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type FieldDescriptor, propertiesOf, type SchemaFieldIndex } from "./schema-fields.js";

/** The surface documentation, shown whenever no cached schema names the fields. */
const GENERIC_FORMS = `Field parameters (instead of --data):
  --<field> <value>          set a field, e.g. --title "Hello"
  --<field>=<value>          same; also the form for many fields in one call
  --<field>.<sub> <value>    set a sub-property, e.g. --body.value "Text"
  --<relationship> <uuid>    reference by UUID; repeat for a multi-valued field
  --json <field>=<json>      raw JSON value, for arrays of objects`;

const RESERVED_NOTE = `A value starting with -- needs the --<field>=<value> form. A field whose name
collides with a reserved option (--bundle, --data, --dry-run, --no-validate,
--format, --auth-profile, --config, --view-mode, --json) can only be set
through --data.`;

export interface CachedSchema {
  schema: unknown;
  /** The site host whose cache directory held it. */
  host: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Locate a cached operation schema without loading the config.
 *
 * Commander renders help synchronously, so the async config load that would
 * give us the site's base URL is out of reach. The cache is laid out as
 * `.dropsh/cache/<host>/schema/<entity>--<bundle>.<op>.json`, so scanning the
 * host directories finds the file regardless of which site is configured — and
 * the host is reported back so the help can say whose fields these are.
 */
export function findCachedSchema(
  cwd: string,
  entity: string,
  bundle: string,
  op: "create" | "update",
): CachedSchema | undefined {
  const root = join(cwd, ".dropsh/cache");
  let hosts: string[];
  try {
    hosts = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return undefined;
  }
  for (const host of hosts) {
    const file = join(root, host, "schema", `${entity}--${bundle}.${op}.json`);
    try {
      const schema = JSON.parse(readFileSync(file, "utf8")) as unknown;
      return { schema, host };
    } catch {
      // Absent or unreadable: try the next host rather than failing the help.
    }
  }
  return undefined;
}

/** Every settable path of an attribute: the field itself, or its dotted leaves. */
function attributePaths(field: FieldDescriptor): string[] {
  const props = propertiesOf(field.node);
  if (!props) return [field.name];
  const nested = Object.keys(props).map((sub) => `${field.name}.${sub}`);
  return nested.length > 0 ? nested : [field.name];
}

function attributeHint(field: FieldDescriptor): string {
  const node = isRecord(field.node) ? field.node : undefined;
  const type = typeof node?.type === "string" ? node.type : undefined;
  if (type === "boolean") return "true|false, or bare for true";
  if (type === "integer" || type === "number") return type;
  if (type === "array") return "use --json";
  return "";
}

function relationshipEntry(field: FieldDescriptor): [string, string] {
  const targets = field.targetTypes ?? [];
  const ambiguous = targets.length > 1;
  const flag = `--${field.name} ${ambiguous ? "<type>:<uuid>" : "<uuid>"}`;
  const notes = [targets.join(" | ") || "(no target type declared)"];
  if (field.multiple === true) notes.push("repeatable");
  return [flag, notes.join(", ")];
}

/**
 * Lay out `[flag, hint]` pairs in one column. The width comes from the longest
 * flag rather than a fixed number, so a long field name still keeps a separator
 * instead of butting straight against its hint.
 */
function columns(entries: [string, string][]): string[] {
  const width = Math.max(...entries.map(([flag]) => flag.length)) + 2;
  return entries.map(([flag, hint]) =>
    hint === "" ? `  ${flag}` : `  ${flag.padEnd(width)}${hint}`,
  );
}

/**
 * Render the field-parameter help. With a cached schema the bundle's real field
 * names are listed; without one, the generic forms plus how to populate the
 * cache.
 */
export function renderFieldHelp(cached?: { index: SchemaFieldIndex; host: string }): string {
  if (!cached) {
    return `\n${GENERIC_FORMS}\n\nField names come from the bundle's schema, so an unknown name is rejected
instead of ignored. Run 'dropsh schema <entity>/<bundle>' once and this help
lists the bundle's actual fields.

${RESERVED_NOTE}`;
  }

  const { index, host } = cached;
  const attributes: FieldDescriptor[] = [];
  const relationships: FieldDescriptor[] = [];
  for (const name of index.order) {
    const field = index.fields.get(name);
    if (!field) continue;
    (field.kind === "attribute" ? attributes : relationships).push(field);
  }

  if (attributes.length === 0 && relationships.length === 0) {
    return `\n${GENERIC_FORMS}\n\nThe cached schema for this bundle declares no fields (from ${host}).

${RESERVED_NOTE}`;
  }

  const lines: string[] = [
    "",
    `Field parameters for ${index.resourceType ?? "this bundle"} (from the schema cached for ${host}):`,
  ];

  // One shared column across attributes, relationships and the --json escape,
  // so the whole block reads as a single table.
  const entries: [string, string][] = [];
  for (const field of attributes) {
    const hint = attributeHint(field);
    for (const path of attributePaths(field)) entries.push([`--${path} <value>`, hint]);
  }
  const attributeCount = entries.length;
  for (const field of relationships) entries.push(relationshipEntry(field));
  entries.push(["--json <field>=<json>", "raw JSON value, for arrays of objects"]);
  const laid = columns(entries);

  if (attributeCount > 0) lines.push("", "  Attributes:", ...laid.slice(0, attributeCount));
  if (relationships.length > 0) {
    lines.push(
      "",
      "  Relationships (take a UUID):",
      ...laid.slice(attributeCount, attributeCount + relationships.length),
    );
  }
  lines.push("", ...laid.slice(-1), "", RESERVED_NOTE);
  return lines.join("\n");
}
