import Ajv, { type ErrorObject } from "ajv";
import draft6MetaSchema from "ajv/dist/refs/json-schema-draft-06.json" with { type: "json" };
import draft7MetaSchema from "ajv/dist/refs/json-schema-draft-07.json" with { type: "json" };
import addFormats from "ajv-formats";
import { ValidationError } from "../../errors.js";

export function validatePayload(schema: unknown, payload: unknown, target: string): void {
  const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false, logger: false });
  // Enforce standard `format` keywords (uri, date-time, uuid, email, …) so a
  // constraint-bearing schema (e.g. from the jsonapi-schema plugin) rejects a
  // malformed value — such as an SCP-style git remote where a URI is required —
  // client-side, before the request is sent. Schemas without `format` are
  // unaffected.
  addFormats(ajv);
  // Schemata (Drupal module) may emit Draft-04 schemas that use `id` instead of `$id`.
  // AJV v8 hard-throws on `id`; removing the keyword makes AJV silently ignore it.
  ajv.removeKeyword("id");
  if (!ajv.getSchema("http://json-schema.org/draft-06/schema#")) {
    ajv.addMetaSchema(draft6MetaSchema);
  }
  if (!ajv.getSchema("http://json-schema.org/draft-07/schema")) {
    ajv.addMetaSchema(draft7MetaSchema);
  }
  // Register the https URI variant so $schema annotations using it resolve correctly.
  if (!ajv.getSchema("https://json-schema.org/draft-07/schema")) {
    ajv.addMetaSchema({ ...draft7MetaSchema, $id: "https://json-schema.org/draft-07/schema" });
  }

  let validate: ReturnType<typeof ajv.compile>;
  try {
    validate = ajv.compile(schema as object);
  } catch (err) {
    throw new ValidationError(
      `schema for ${target} cannot be compiled: ${(err as Error).message}`,
      { cause: String(err) },
    );
  }

  const ok = validate(payload);
  if (!ok) {
    const errors = (validate.errors ?? []) as ErrorObject[];
    throw new ValidationError(`payload does not match schema for ${target}`, { errors });
  }
}
