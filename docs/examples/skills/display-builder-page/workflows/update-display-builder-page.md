# Update Display Builder Page Workflow

Update an existing Display Builder page while preserving unrelated entity fields
and source-tree items.

## Steps

1. Locate the target entity.

   ```bash
   dropsh search node --bundle=landing_page --filter='title:Example title' --limit=10
   ```

2. Read the current entity.

   ```bash
   dropsh read node/landing_page/<uuid>
   ```

3. Refresh the update schema.

   ```bash
   dropsh schema node/landing_page --for=update --refresh
   ```

4. Read Display Builder metadata from the schema.

   - `override_field`
   - `source_tree`
   - `component_library`
   - available component definitions

5. Build a minimal update payload.

   - Keep the current override field structure unless replacing it is the user's
     explicit request.
   - Change only the intended source-tree item or entity attribute.
   - Preserve component identities and nesting data where present.

6. Validate with a dry run.

   ```bash
   dropsh update node/landing_page/<uuid> --data=@display-builder-page-update.json --dry-run
   ```

7. Send the update and read it back.

   ```bash
   dropsh update node/landing_page/<uuid> --data=@display-builder-page-update.json
   dropsh read node/landing_page/<uuid>
   ```

## Guardrails

- Do not assume the target bundle is `landing_page`; use the project target.
- Do not assume the Display Builder override field name.
- Do not replace the whole source tree for a small text or component-input edit.
