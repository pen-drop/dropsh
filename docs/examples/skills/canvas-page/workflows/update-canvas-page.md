# Update Canvas Page Workflow

Update an existing Drupal Canvas page while preserving the component tree unless
the user explicitly asks to replace it.

## Steps

1. Locate the Canvas page.

   ```bash
   dropsh search canvas_page --bundle=canvas_page --filter='title:Example title' --limit=10
   ```

2. Read the current page.

   ```bash
   dropsh read canvas_page/canvas_page/<uuid>
   ```

3. Refresh the Canvas update schema.

   ```bash
   dropsh schema canvas_page/canvas_page --for=update --refresh
   ```

4. Plan the minimal component-tree change.

   - Preserve existing component UUIDs when editing existing components.
   - Add new UUIDs only for new tree items.
   - Preserve unaffected `parent_uuid` and `slot` relationships.
   - Update only the intended component `inputs`.

5. Validate with a dry run.

   ```bash
   dropsh update canvas_page/canvas_page/<uuid> --data=@canvas-page-update.json --dry-run
   ```

6. Send the update and read it back.

   ```bash
   dropsh update canvas_page/canvas_page/<uuid> --data=@canvas-page-update.json
   dropsh read canvas_page/canvas_page/<uuid>
   ```

## Guardrails

- Do not rebuild the whole component tree for a small copy or input change.
- Do not change component versions unless the refreshed schema requires it.
- If the existing page contains components no longer present in the schema, stop
  and report that the site configuration changed.
