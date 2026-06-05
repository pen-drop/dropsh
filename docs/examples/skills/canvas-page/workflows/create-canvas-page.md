# Create Canvas Page Workflow

Create a Drupal Canvas page using the component schema emitted by
`@dropsh/plugin-canvas`.

## Steps

1. Confirm authentication.

   ```bash
   dropsh auth status
   ```

2. Refresh the Canvas create schema.

   ```bash
   dropsh schema canvas_page/canvas_page --for=create --refresh
   ```

3. Confirm schema metadata.

   - `x-dropsh-builder` is `canvas`
   - `x-dropsh-components` contains the needed components
   - `data.attributes.components` is present and typed

4. Build the page payload.

   - Use a UUID for each component tree item.
   - Use `parent_uuid: null` and `slot: null` for root components.
   - For children, set `parent_uuid` to an existing component UUID and `slot` to
     a slot listed by the parent component schema.
   - Copy each `component_version` from the schema. Do not omit or invent it.
   - Shape `inputs` from the component's props schema.

5. Validate with a dry run.

   ```bash
   dropsh create canvas_page --bundle=canvas_page --data=@canvas-page.json --dry-run
   ```

6. Create the page.

   ```bash
   dropsh create canvas_page --bundle=canvas_page --data=@canvas-page.json
   ```

7. Read the stored page.

   ```bash
   dropsh read canvas_page/canvas_page/<uuid>
   ```

## Error Handling

- If `jsonapi_sdc` is missing or inaccessible, stop. The Canvas plugin should
  fail rather than validate against incomplete component metadata.
- If a component has no version in the schema, treat it as not placeable in the
  Canvas payload.
- If validation rejects a slot, re-check the parent component's slot list.

