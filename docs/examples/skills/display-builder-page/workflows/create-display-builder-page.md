# Create Display Builder Page Workflow

Create a Drupal entity whose Display Builder source tree is represented in a
configured override field.

## Steps

1. Confirm authentication.

   ```bash
   dropsh auth status
   ```

2. Refresh the create schema for the project-specific target.

   ```bash
   dropsh schema node/landing_page --for=create --refresh
   ```

3. Confirm Display Builder metadata.

   - `x-dropsh-builder` is `display-builder`
   - `x-dropsh-display-builder.override_field` is present
   - `x-dropsh-display-builder.component_library` describes allowed components
   - `x-dropsh-components` contains component prop and slot metadata

4. Build the payload.

   - Put the source tree in the schema's `override_field`.
   - Use only components allowed by the active component library.
   - Shape component input data from `x-dropsh-components`.
   - Include normal entity fields required by the base schema, such as title.

5. Validate with a dry run.

   ```bash
   dropsh create node --bundle=landing_page --data=@display-builder-page.json --dry-run
   ```

6. Create the page and read it back.

   ```bash
   dropsh create node --bundle=landing_page --data=@display-builder-page.json
   dropsh read node/landing_page/<uuid>
   ```

## Error Handling

- If the schema is not Display Builder-enabled, stop and report that the active
  display does not expose Display Builder metadata.
- If the override field is missing, do not fall back to common field names.
- If a component is outside the active library, choose an allowed component or
  ask for a configuration change.

