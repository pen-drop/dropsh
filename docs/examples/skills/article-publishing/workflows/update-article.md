# Update Article Workflow

Update an existing Drupal article node through dropsh.

## Steps

1. Locate the target article.

   ```bash
   dropsh search node --bundle=article --filter='title:Example title' --limit=10
   ```

2. Read the current record before editing.

   ```bash
   dropsh read node/article/<uuid>
   ```

3. Load an update schema.

   ```bash
   dropsh schema node/article --for=update --refresh
   ```

4. Build a minimal update payload with only the intended changes.

5. Validate with a dry run.

   ```bash
   dropsh update node/article/<uuid> --data=@article-update.json --dry-run
   ```

6. Send the update.

   ```bash
   dropsh update node/article/<uuid> --data=@article-update.json
   ```

7. Read the record again and verify the changed fields.

   ```bash
   dropsh read node/article/<uuid>
   ```

## Guardrails

- Never overwrite unrelated fields just because they appeared in the read
  response.
- Preserve relationships unless the user explicitly asks to change them.
- Use the current UUID from `search` or `read`; do not derive UUIDs from titles
  or aliases.
